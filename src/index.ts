#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchXiaohongshu } from "./xiaohongshu.js";
import { z } from "zod";

// Create MCP server
const server = new McpServer({
  name: "rednote-mcp",
  version: "1.0.0",
  description: "MCP server for searching and retrieving content from Xiaohongshu (Red Note) platform.",
});

// Define rednote content search tool
server.tool(
  "search_xiaohongshu",
  {
    query: z.string().describe("Search query for Xiaohongshu content"),
    count: z.number().optional().default(10).describe("Number of results to return")
  },
  async (params: { query: string; count: number }, extra) => {
    const { query, count } = params;
    try {
      console.error(`Searching Xiaohongshu: ${query}, Count: ${count}`);
      
      // Search Xiaohongshu content
      const results = await searchXiaohongshu(query, count);

      let noteMarkdown = `# Xiaohongshu Search Results: "${query}"\n\nFound ${results.length} related notes`
      
      // Process each note
      for (let i = 0; i < results.length; i++) {
        const note = results[i];
        
        // Build note markdown content
        noteMarkdown += `## ${i+1}. ${note.title}\n\n`;
        
        // Add author information
        noteMarkdown += `**Author:** ${note.author}`;
        if (note.authorDesc) {
          noteMarkdown += ` (${note.authorDesc})`;
        }
        noteMarkdown += '\n\n';
        
        // Add interaction data
        let interactionInfo = [];
        if (typeof note.likes !== 'undefined') interactionInfo.push(`👍 ${note.likes} likes`);
        if (typeof note.collects !== 'undefined') interactionInfo.push(`⭐ ${note.collects} favorites`);
        if (typeof note.comments !== 'undefined') interactionInfo.push(`💬 ${note.comments} comments`);
        
        if (interactionInfo.length > 0) {
          noteMarkdown += `**Interaction data:** ${interactionInfo.join(' · ')}\n\n`;
        }
        
        // Add content
        noteMarkdown += `### Content\n\n${note.content.trim()}\n\n`;

        // Add images
        if (note.images && note.images.length > 0) {
          const imagesToShow = note.images;
          
          for (let j = 0; j < imagesToShow.length; j++) {
            noteMarkdown += `### Image${j}: ${imagesToShow[j]}\n`;
          }
        }
        
        // Add tags
        if (note.tags && note.tags.length > 0) {
          noteMarkdown += `**Tags:** ${note.tags.map(tag => `#${tag}`).join(' ')}\n\n`;
        }
        
        // Add link
        noteMarkdown += `**Original link:** ${note.link}\n\n`;

        noteMarkdown += "\n-----\n\n"
        
        // Add separator after each note (except the last one)
        if (i >= results.length - 1) {
          noteMarkdown += `\n\nAbove are all ${results.length} Xiaohongshu notes about "${query}".`
        }
      }
      
      return {
        content: [{
          type: "text",
          text: noteMarkdown
        }]
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