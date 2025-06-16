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
app.use('/static', express.static('static'));
// Normalize domain: remove trailing slash, enforce lowercase
const normalizeDomain = (domain) => {
  if (!domain) return domain;
  return domain.toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, 'https://') // unify www
    .replace(/\/$/, '');
};

const STATIC_DOMAINS = ['https://chatbot-blue-zeta.vercel.app'];

const corsOptions = {
  origin: async function (origin, callback, req) {
    try {
      console.log('CORS check:', {
        origin,
        url: req ? req.url : 'undefined',
        method: req ? req.method : 'undefined',
        headers: req ? req.headers : 'undefined',
        ip: req ? req.ip : 'undefined'
      });
      if (!origin) {
        console.log('No origin, allowing request for URL:', req ? req.url : 'undefined');
        if ((req && req.url && req.url.startsWith('/static')) || (req && req.method === 'OPTIONS')) {
          return callback(null, true);
        }
        console.warn('Rejecting undefined origin for non-static/non-OPTIONS request:', req ? req.url : 'undefined');
        return callback(new Error('Origin required for this request'));
      }
      const normalizedOrigin = normalizeDomain(origin);
      console.log('Normalized origin:', normalizedOrigin);
      if (STATIC_DOMAINS.includes(normalizedOrigin) || normalizedOrigin.startsWith('http://localhost')) {
        console.log('Allowing static or localhost origin:', normalizedOrigin);
        return callback(null, true);
      }
      const user = await User.findOne({ allowedDomains: normalizedOrigin });
      if (user) {
        console.log('Origin allowed for user:', { userId: user._id, origin: normalizedOrigin });
        return callback(null, true);
      }
      console.warn('CORS rejected for origin:', normalizedOrigin);
      callback(new Error('Not allowed by CORS'));
    } catch (err) {
      console.error('CORS processing error:', err);
      callback(new Error('CORS processing error'));
    }
  },
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
  methods: ['GET', 'POST', 'OPTIONS'],
  preflightContinue: false
};

app.use(cors(corsOptions));
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
console.log('MongoDB connected');


const UPGRADE_MESSAGE = 'You have reached your plan limit. Upgrade to the paid plan for unlimited questions and uploads at https://careerengine.in/upgrade.';

const checkLimits = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    console.log('checkLimits:', { userId: req.user.id, plan: user.plan, uploadCount: user.uploadCount });
    if (user.plan === 'paid' && user.subscriptionStatus === 'active') {
      return next();
    }
    if (user.uploadCount >= 5) {
      return res.status(403).json({ reply: UPGRADE_MESSAGE });
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
  res.json(
    { token, 
      userid:user._id,
    });
});

app.get('/user/domains', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('allowedDomains');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ domains: user.allowedDomains });
  } catch (err) {
    console.error('Fetch domains error:', err);
    res.status(500).json({ error: 'Failed to fetch domains' });
  }
});

app.post('/add-domain', authenticateToken, async (req, res) => {
  const { domain } = req.body;
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ error: 'Invalid domain' });
  }
  const normalizedDomain = normalizeDomain(domain);
  const domainRegex = /^https?:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
  if (!domainRegex.test(normalizedDomain)) {
    return res.status(400).json({ error: 'Invalid domain format. Must be a valid URL (e.g., https://customerwebsite.com)' });
  }
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.allowedDomains.includes(normalizedDomain)) {
      user.allowedDomains.push(normalizedDomain);
      await user.save();
      console.log('Domain added:', { userId: req.user.id, domain: normalizedDomain });
    }
    res.json({ message: 'Domain added successfully' });
  } catch (err) {
    console.error('Add domain error:', err);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

app.post('/upload', authenticateToken, checkLimits, async (req, res) => {
  const { data, filename, visitorId = 'default' } = req.body;
  console.log('Upload request:', { userId: req.user.id, visitorId, filename, dataLength: data?.length });
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
      console.log('Upserting vector:', {
        id: vectorId,
        userId: req.user.id,
        visitorId,
        filename,
        textLength: chunk.length
      });
    }
    if (vectors.length > 0) {
      await index.upsert(vectors);
      console.log('Vectors upserted:', { vectorCount: vectors.length, userId: req.user.id, visitorId });
    } else {
      console.warn('No vectors to upsert for upload:', { userId: req.user.id, visitorId, filename });
    }
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
    console.log('Chat request:', { userId: req.user.id, plan: user.plan, questionCount: user.questionCount });
    if (user.plan === 'free' && user.questionCount >= 20) {
      console.log('Question limit reached for user:', req.user.id);
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
    if (reply === UPGRADE_MESSAGE) {
      console.log('Returning upgrade message for user:', req.user.id);
      return res.status(403).json({ reply });
    }
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
      console.log('WhatsApp question limit reached for user:', user._id);
      await twilioClient.messages.create({
        body: UPGRADE_MESSAGE,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
      });
      return res.status(200).send('OK');
    }
    const reply = await processMessage(incomingMessage, user, 'default');
    if (reply === UPGRADE_MESSAGE) {
      console.log('WhatsApp returning upgrade message for user:', user._id);
      await twilioClient.messages.create({
        body: reply,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: fromNumber,
      });
      return res.status(200).send('OK');
    }
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
  console.log('processMessage:', { userId: user._id, plan: user.plan, questionCount: user.questionCount });
  if (user.plan === 'free' && user.questionCount >= 20) {
    console.log('Question limit reached in processMessage for user:', user._id);
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
    let queryResponse = await index.query({
      vector: queryEmbedding,
      topK: 5,
      includeMetadata: true,
      filter: {
        userId: user._id.toString(),
        visitorId
      }
    });
    console.log('Pinecone query with visitorId filter:', {
      userId: user._id.toString(),
      visitorId,
      matchCount: queryResponse.matches.length,
      matches: queryResponse.matches.map(m => ({
        id: m.id,
        score: m.score,
        userId: m.metadata.userId,
        visitorId: m.metadata.visitorId,
        filename: m.metadata.filename,
        textLength: m.metadata.text.length
      }))
    });
    if (queryResponse.matches.length === 0) {
      console.warn('No matches with visitorId filter, trying userId only:', { userId: user._id.toString() });
      queryResponse = await index.query({
        vector: queryEmbedding,
        topK: 5,
        includeMetadata: true,
        filter: {
          userId: user._id.toString()
        }
      });
      console.log('Pinecone query with userId only:', {
        userId: user._id.toString(),
        matchCount: queryResponse.matches.length,
        matches: queryResponse.matches.map(m => ({
          id: m.id,
          score: m.score,
          userId: m.metadata.userId,
          visitorId: m.metadata.visitorId,
          filename: m.metadata.filename,
          textLength: m.metadata.text.length
        }))
      });
    }
    const context = queryResponse.matches.map(match => match.metadata.text).join('\n');
    console.log('Context length:', context.length, 'Context sample:', context.slice(0, 200));
    if (!context) {
      console.warn('No context retrieved from Pinecone for query:', message);
      return 'I don’t have any relevant information to answer this question. Please upload data or ask something else.';
    }
    const completionResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Use the provided context to answer questions accurately. If asked about the number of items (e.g., stories), count distinct items based on metadata (e.g., filename). Summarize or list items if relevant.',
        },
        {
          role: 'user',
          content: `Context: ${context}\n\nQuestion: ${message}`
        },
      ],
    });
    if (user.plan === 'free') {
      user.questionCount += 1;
      await user.save();
    }
    const reply = completionResponse.choices[0].message.content;
    console.log('GPT reply:', reply);
    return reply;
  } catch (err) {
    console.error('Process message error:', err);
    return 'Error processing your request. Please try again.';
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});