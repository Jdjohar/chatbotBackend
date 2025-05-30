const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const User = require('./models/User');
const Chat = require('./models/Chat');
const cors = require('cors');
const { job } = require('./cron');
// const uploadRoute = require('./routes/upload');
// const authenticateToken = require('./middleware/authenticateToken')

dotenv.config();
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
// app.use('/upload', uploadRoute);
job.start(); 
app.use(cors({
  origin: 'https://chatbot-blue-zeta.vercel.app', // allow Vite frontend
  credentials: true                // allow cookies/auth headers if needed
}));
app.use(cors());
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
console.log('MongoDB connected');

const checkLimits = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.uploadCount >= 5) {
    return res.status(403).json({ error: 'Upload limit reached (5)' });
  }

  next();
};


// OpenAI & Pinecone initialization
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX);

// Twilio initialization
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = { id: decoded.userId };  // set this instead of req.userId
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}


// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  console.log(username, password);
  
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: 'User already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed });
  await user.save();
  res.json({ message: 'User created' });
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid login' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid login' });

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
  res.json({ token });
});


// Upload route
app.post('/upload', authenticateToken, checkLimits, async (req, res) => {
  const { data, filename } = req.body;
 console.log('req.body:', req.body);
  if (!data || !filename) {
    return res.status(400).json({ error: 'Data and filename are required' });
  }

  try {
    // Initialize OpenAI and Pinecone
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.Index(process.env.PINECONE_INDEX);

    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunk,
      });

      const embedding = embeddingResponse.data[0].embedding;

      await index.upsert([
        {
          id: `${req.userId}_${filename}_${i}`,
          values: embedding,
          metadata: {
            userId: req.user.id,
            text: chunk,
            filename,
          },
        },
      ]);
    }

    // Increment user's upload count
    const user = await User.findById(req.user.id);
    console.log("user:",user);
    console.log("req.userId:",req.user.id);
    
    user.uploadCount += 1;
    await user.save();

    res.status(200).json({ message: 'Data embedded and stored successfully' });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Error processing upload' });
  }
});



// Chat API with auth
// Inside your /chat endpoint
app.post('/chat', authenticateToken, async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.questionCount >= 20) {
      return res.status(403).json({ reply: '❌ You have reached your 20-question limit.' });
    }

    const reply = await processMessage(message, user);

    // Save chat to DB
    const chat = new Chat({ userId: user._id, message, reply });
    await chat.save();

    user.questionCount += 1;
    await user.save();

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user.id }).sort({ createdAt: 1 });
    res.json(chats);
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

app.use(express.urlencoded({ extended: true }));
// WhatsApp webhook
app.post('/whatsapp', async (req, res) => {
  const incomingMessage = req.body.Body;
  const fromNumber = req.body.From;

  try {
    if (!fromNumber) {
      console.error('Missing "From" in request body:', req.body);
      return res.status(400).send('Missing sender number.');
    }

    const user = await User.findOne();

    if (!incomingMessage || typeof incomingMessage !== 'string') {
      await twilioClient.messages.create({
        body: 'Please send a valid message.',
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
      });
      return res.status(200).send('OK');
    }

    const reply = await processMessage(incomingMessage, user);

    await twilioClient.messages.create({
      body: reply,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing WhatsApp message:', error.message);
    res.status(200).send('OK');
  }
});

// Core logic: Embed + Completion
async function processMessage(message, user) {
  if (user.questionsUsed >= 20) {
    return 'You have reached your 20-question limit.';
  }

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: message.trim(),
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  const queryResponse = await index.query({
    vector: queryEmbedding,
    topK: 5,
    includeMetadata: true,
  });

  const context = queryResponse.matches.map(match => match.metadata.text).join('\n');

  const completionResponse = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant. Use the provided context to answer questions accurately.',
      },
      { role: 'user', content: `Context: ${context}\n\nQuestion: ${message}` },
    ],
  });

  user.questionsUsed += 1;
  await user.save();

  return completionResponse.choices[0].message.content;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
