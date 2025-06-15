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
const Analytics = require('./models/Analytics');
const widgetRoute = require('./routes/widget');
const cors = require('cors');
const { job } = require('./cron');
const authenticateApiKey = require('./middleware/authenticateApiKey');

dotenv.config();
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const allowedOrigins = [
  'https://chatbot-blue-zeta.vercel.app',
  'https://careerengine.in',
  'http://localhost:5173'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
console.log('MongoDB connected');
app.use('/static', express.static('static'));

const UPGRADE_MESSAGE = 'You have reached your plan limit. Upgrade to the paid plan for unlimited questions and uploads at https://careerengine.in/upgrade.';

const checkLimits = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.plan === 'paid' && user.subscriptionStatus === 'active') {
      return next();
    }
    if (user.uploadCount >= 5) {
      return res.status(403).json({ error: UPGRADE_MESSAGE });
    }
    next();
  } catch (err) {
    console.error('Limit check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = { id: decoded.userId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.use('/widget', widgetRoute);

app.get('/chats', authenticateApiKey, async (req, res) => {
  const { visitorId } = req.query;
  if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });
  try {
    const chats = await Chat.find({ userId: req.user.id, visitorId }).sort({ createdAt: 1 });
    res.json(chats);
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

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

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid login' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid login' });
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
  res.json({ token });
});

app.post('/upload', authenticateToken, checkLimits, async (req, res) => {
  const { data, filename, visitorId = 'default' } = req.body;
  console.log('Upload req.body:', { userId: req.user.id, visitorId, filename, dataLength: data?.length });
  if (!data || !filename) {
    return res.status(400).json({ error: 'Data and filename are required' });
  }
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    const vectors = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (!chunk) continue;
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunk,
      });
      const embedding = embeddingResponse.data[0].embedding;
      const vectorId = `${req.user.id}_${visitorId}_${filename}_${i}`;
      vectors.push({
        id: vectorId,
        values: embedding,
        metadata: {
          userId: req.user.id.toString(),
          visitorId,
          text: chunk,
          filename
        }
      });
      console.log('Upserting vector:', { id: vectorId, userId: req.user.id, visitorId });
    }
    await index.upsert(vectors);
    if (user.plan === 'free') {
      user.uploadCount += 1;
    }
    await user.save();
    res.status(200).json({ message: 'Data embedded and stored successfully' });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Error processing upload' });
  }
});

app.post('/chat', authenticateApiKey, async (req, res) => {
  const { message, visitorId } = req.body;
  if (!message || typeof message !== 'string' || !visitorId) {
    return res.status(400).json({ error: 'Invalid message or visitorId' });
  }
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.plan === 'free' && user.questionCount >= 20) {
      return res.status(403).json({ reply: UPGRADE_MESSAGE });
    }
    const analytics = await Analytics.findOne({ userId: req.user.id });
    if (analytics) {
      analytics.conversationCount += 1;
      const question = analytics.commonQuestions.find(q => q.question === message);
      if (question) question.count += 1;
      else analytics.commonQuestions.push({ question: message, count: 1 });
      await analytics.save();
    } else {
      await Analytics.create({
        userId: req.user.id,
        conversationCount: 1,
        commonQuestions: [{ question: message, count: 1 }]
      });
    }
    const reply = await processMessage(message, user, visitorId);
    const chat = new Chat({ userId: user._id, visitorId, message, reply });
    await chat.save();
    if (user.plan === 'free') {
      user.questionCount += 1;
    }
    await user.save();
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/plan', authenticateApiKey, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('plan subscriptionStatus questionCount uploadCount');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      questionCount: user.questionCount,
      uploadCount: user.uploadCount
    });
  } catch (err) {
    console.error('Plan fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch plan details' });
  }
});

app.use(express.urlencoded({ extended: true }));
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
    if (user.plan === 'free' && user.questionCount >= 20) {
      await twilioClient.messages.create({
        body: UPGRADE_MESSAGE,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
      });
      return res.status(200).send('OK');
    }
    const reply = await processMessage(incomingMessage, user, 'default');
    await twilioClient.messages.create({
      body: reply,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: fromNumber,
    });
    if (user.plan === 'free') {
      user.questionCount += 1;
      await user.save();
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing WhatsApp message:', error.message);
    res.status(200).send('OK');
  }
});

async function processMessage(message, user, visitorId = 'default') {
  if (user.plan === 'free' && user.questionCount >= 20) {
    return UPGRADE_MESSAGE;
  }
  if (!visitorId || typeof visitorId !== 'string') {
    console.error('Invalid visitorId:', visitorId);
    return 'Error: Invalid visitor ID.';
  }
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: message.trim(),
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;
    const filter = {
      userId: user._id.toString(),
      visitorId
    };
    console.log('Pinecone query filter:', { userId: user._id.toString(), visitorId });
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: 5,
      includeMetadata: true,
      filter
    });
    console.log('Pinecone query results:', queryResponse.matches.map(m => ({
      id: m.id,
      userId: m.metadata.userId,
      visitorId: m.metadata.visitorId
    })));
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
    if (user.plan === 'free') {
      user.questionCount += 1;
      await user.save();
    }
    return completionResponse.choices[0].message.content;
  } catch (err) {
    console.error('Process message error:', err);
    return 'Error processing your request.';
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});