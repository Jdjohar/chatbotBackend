const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Reference to your Pinecone index
const indexName = process.env.PINECONE_INDEX;
const index = pinecone.Index(indexName);

async function createEmbeddings() {
  try {
    const dataDir = './data';
    const files = await fs.readdir(dataDir);

    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const text = await fs.readFile(filePath, 'utf-8');

      // Split text into chunks (e.g., 2000 characters)
      const chunkSize = 2000;
      const chunks = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Create embedding using OpenAI
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: chunk,
        });

        const embedding = embeddingResponse.data[0].embedding;

        // Store embedding in Pinecone
        await index.upsert([
          {
            id: `${file}_${i}`,
            values: embedding,
            metadata: {
              text: chunk,
              userId: userId, // Add user ID here
            },
          },
        ]);

        console.log(`Stored embedding for chunk ${i + 1} of ${file}`);
      }
    }
    console.log('All embeddings stored successfully');
  } catch (error) {
    console.error('Error creating embeddings:', error);
  }
}

createEmbeddings();