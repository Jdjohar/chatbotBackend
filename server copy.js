const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const index = pinecone.Index(process.env.PINECONE_INDEX);

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  try {
    // Create embedding for user input
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: message,
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Query Pinecone for relevant context
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: 5,
      includeMetadata: true,
    });

    // Extract context from Pinecone results
    const context = queryResponse.matches
      .map((match) => match.metadata.text)
      .join('\n');

    // Generate response using OpenAI
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

    const reply = completionResponse.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});