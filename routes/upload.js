const fs = require('fs').promises;
const express = require('express');
const path = require('path');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const User = require('../models/User'); // Your MongoDB User model
const app = express();
const authenticateToken = require('../middleware/authenticateToken')
// Middleware to check upload limit
const checkUploadLimit = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.uploadCount >= 5) {
    return res.status(403).json({ error: 'Upload limit reached (5)' });
  }

  next();
};

// Upload route
app.post('/upload', authenticateToken, checkUploadLimit, async (req, res) => {
  const { data, filename } = req.body;

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
          id: `${req.user.id}_${filename}_${i}`,
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
    user.uploadCount += 1;
    await user.save();

    res.status(200).json({ message: 'Data embedded and stored successfully' });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Error processing upload' });
  }
});
