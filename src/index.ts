#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchXiaohongshu } from "./xiaohongshu.js";
import { z } from "zod";
import { text } from "stream/consumers";

// Create MCP server
const server = new McpServer({
  name: "rednote-mcp",
  version: "1.1.0",
  description: "MCP server for searching and retrieving content from Xiaohongshu (Red Note) platform.",
});

type ContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "resource";
      resource: {
        uri: string;
        text: string;
        mimeType?: string; // mimeType is optional
      };
    };

server.tool(
  "search_xiaohongshu",
  "Searches for content on Xiaohongshu (Red Note) based on a query",
  {
    query: z.string().describe("Search query for Xiaohongshu content"),
    count: z.number().optional().default(10).describe("Number of results to return")
  },
  async (params: { query: string; count: number }, extra) => {
    const { query, count } = params;
    try {
      console.error(`Searching Xiaohongshu: ${query}, Count: ${count}`);
      
      // 1. Fetch search results from Xiaohongshu
      const results = await searchXiaohongshu(query, count);

      // 2. Initialize an array for content blocks with our explicit type.
      const contentBlocks: ContentBlock[] = [];

      // Add a main header for the search results.
      contentBlocks.push({
        type: "text",
        text: `# Xiaohongshu Search Results for "${query}"\n\nFound ${results.length} related notes.`
      });

      // 3. Loop through each note to generate its corresponding text and image blocks.
      for (let i = 0; i < results.length; i++) {
        const note = results[i];
        
        // --- Generate text content for the current note ---
        // Requirement: Add a number to each note title.
        let noteTextContent = `## ${i + 1}. ${note.title}\n\n`;
        
        // Author information
        noteTextContent += `**Author:** ${note.author}`;
        if (note.authorDesc) {
          noteTextContent += ` (${note.authorDesc})`;
        }
        noteTextContent += '\n\n';
        
        // Interaction data
        const interactionInfo = [];
        if (typeof note.likes !== 'undefined') interactionInfo.push(`👍 ${note.likes}`);
        if (typeof note.collects !== 'undefined') interactionInfo.push(`⭐ ${note.collects}`);
        if (typeof note.comments !== 'undefined') interactionInfo.push(`💬 ${note.comments}`);
        if (interactionInfo.length > 0) {
          noteTextContent += `**Interactions:** ${interactionInfo.join(' · ')}\n\n`;
        }
        
        // Note content body
        noteTextContent += `### Content\n${note.content.trim()}\n\n`;

        // Tags
        if (note.tags && note.tags.length > 0) {
          noteTextContent += `**Tags:** ${note.tags.map(tag => `#${tag}`).join(' ')}\n\n`;
        }
        
        // Original Link
        noteTextContent += `**Original Link:** ${note.link}`;

        // Add the formatted text block to the array
        contentBlocks.push({
          type: "text",
          text: noteTextContent
        });

        // --- Generate resource links for images in the current note ---
        if (note.images && note.images.length > 0) {
          for (let j = 0; j < note.images.length; j++) {
            const imageUrl = note.images[j];

            // Requirement: Number each image in its description text.
            // Add each image as a separate resource link object.
            contentBlocks.push({
              type: "resource",
              resource: {
                uri: imageUrl,
                // The 'text' property is required by the type definition.
                text: `Image ${j + 1} for note: "${note.title}"`
              }
            });
          }
        }

        // Add a separator block to visually distinguish notes.
        contentBlocks.push({
          type: "text",
          text: "\n\n---\n\n"
        });
      }
      
      // 4. Return the structured JSON object containing all content blocks.
      return {
        content: contentBlocks
      };

    } catch (error) {
      console.error("Xiaohongshu search error:", error);
      return {
        content: [{ 
          type: "text", 
          text: `Error searching Xiaohongshu content: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Xiaohongshu MCP server started, listening for messages via stdio");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main(); 