#!/usr/bin/env node

/**
 * Codeforces AI Analytics Server — src/index.ts
 *
 * Architecture:
 *  • Express HTTP server (port 8080 for Google Cloud Run)
 *  • MCP protocol delivered via SSEServerTransport (/sse + /messages)
 *  • MongoDB caching via Mongoose (24-hour TTL)
 *  • TensorFlow rating prediction via Python child_process
 */

import "dotenv/config";
import express from "express";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import {
  connectDB,
  CACHE_TTL_MS,
  UserProfileCache,
  RatingHistoryCache,
} from "./db.js";

// ─── Path helpers ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve to <project-root>/ai/predict.py regardless of CWD
const AI_SCRIPT = path.resolve(__dirname, "../../ai/predict.py");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CodeforcesUser {
  handle: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  contribution: number;
  rank?: string;
  rating?: number;
  maxRank?: string;
  maxRating?: number;
  lastOnlineTimeSeconds: number;
  registrationTimeSeconds: number;
  friendOfCount: number;
  avatar?: string;
  titlePhoto?: string;
}

interface CodeforcesSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: {
    contestId?: number;
    index: string;
    name: string;
    type: string;
    points?: number;
    rating?: number;
    tags: string[];
  };
  author: {
    contestId?: number;
    members: Array<{ handle: string; name?: string }>;
    participantType: string;
    ghost?: boolean;
    room?: number;
    startTimeSeconds?: number;
  };
  programmingLanguage: string;
  verdict?: string;
  testset: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  points?: number;
}

interface CodeforcesContest {
  id: number;
  name: string;
  type: string;
  phase: string;
  frozen: boolean;
  durationSeconds: number;
  startTimeSeconds?: number;
  relativeTimeSeconds?: number;
  preparedBy?: string;
  websiteUrl?: string;
  description?: string;
  difficulty?: number;
  kind?: string;
  icpcRegion?: string;
  country?: string;
  city?: string;
  season?: string;
}

interface CodeforcesRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

// ─── Codeforces API Client (with MongoDB caching) ──────────────────────────────

class CodeforcesAPI {
  private readonly baseUrl = "https://codeforces.com/api";
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: { "User-Agent": "Codeforces-AI-Analytics-Server/2.0.0" },
    });
  }

  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    try {
      const response = await this.httpClient.get(endpoint, { params });
      if (response.data.status !== "OK") {
        throw new Error(
          `API Error: ${response.data.comment || "Unknown error"}`
        );
      }
      return response.data.result as T;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Request failed: ${error.message}`);
      }
      throw error;
    }
  }

  // ── getUserInfo — with MongoDB cache ────────────────────────────────────────

  async getUserInfo(handles: string[]): Promise<CodeforcesUser[]> {
    // For simplicity, cache only single-handle lookups
    if (handles.length === 1) {
      const key = handles[0].toLowerCase();
      const cached = await UserProfileCache.findOne({ handle: key });
      if (cached) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
          console.log(`[cache HIT] user profile: ${key}`);
          return [cached.data as CodeforcesUser];
        }
      }
      const data = await this.makeRequest<CodeforcesUser[]>("user.info", {
        handles: handles.join(";"),
      });
      await UserProfileCache.findOneAndUpdate(
        { handle: key },
        { data: data[0], fetchedAt: new Date() },
        { upsert: true, new: true }
      );
      return data;
    }

    // Multi-handle: skip cache, hit API directly
    return this.makeRequest<CodeforcesUser[]>("user.info", {
      handles: handles.join(";"),
    });
  }

  // ── getUserRating — with MongoDB cache ──────────────────────────────────────

  async getUserRating(handle: string): Promise<CodeforcesRatingChange[]> {
    const key = handle.toLowerCase();
    const cached = await RatingHistoryCache.findOne({ handle: key });
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        console.log(`[cache HIT] rating history: ${key}`);
        return cached.data as CodeforcesRatingChange[];
      }
    }
    const data = await this.makeRequest<CodeforcesRatingChange[]>(
      "user.rating",
      { handle }
    );
    await RatingHistoryCache.findOneAndUpdate(
      { handle: key },
      { data, fetchedAt: new Date() },
      { upsert: true, new: true }
    );
    return data;
  }

  // ── Other API methods (no cache needed for these) ───────────────────────────

  async getUserStatus(
    handle: string,
    from = 1,
    count = 10
  ): Promise<CodeforcesSubmission[]> {
    return this.makeRequest<CodeforcesSubmission[]>("user.status", {
      handle,
      from,
      count,
    });
  }

  async getContestList(gym = false): Promise<CodeforcesContest[]> {
    return this.makeRequest<CodeforcesContest[]>("contest.list", { gym });
  }

  async getContestStandings(
    contestId: number,
    from = 1,
    count = 10
  ): Promise<unknown> {
    return this.makeRequest("contest.standings", { contestId, from, count });
  }

  async getProblemsFromProblemset(tags: string[] = []): Promise<unknown> {
    const params: Record<string, unknown> = {};
    if (tags.length > 0) params.tags = tags.join(";");
    return this.makeRequest("problemset.problems", params);
  }
}

// ─── Python prediction helper ──────────────────────────────────────────────────

function runPythonPredictor(ratings: number[]): Promise<object> {
  return new Promise((resolve, reject) => {
    const arg = JSON.stringify(ratings);
    // Use 'python3' on Linux/Mac (Docker), fall back to 'python' on Windows
    const pyCmd =
      process.platform === "win32" ? "python" : "python3";
    const cmd = `${pyCmd} "${AI_SCRIPT}" '${arg}'`;

    exec(cmd, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(
          new Error(`Python process failed: ${err.message}\nstderr: ${stderr}`)
        );
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Failed to parse Python output: ${stdout}`));
      }
    });
  });
}

// ─── MCP Server ────────────────────────────────────────────────────────────────

class CodeforcesServer {
  private mcpServer: Server;
  private api: CodeforcesAPI;

  constructor() {
    this.mcpServer = new Server(
      { name: "codeforces-ai-analytics", version: "2.0.0" }
    );
    this.api = new CodeforcesAPI();
    this.setupHandlers();
  }

  getMcpServer(): Server {
    return this.mcpServer;
  }

  // ── Resource Handlers ────────────────────────────────────────────────────────

  private setupHandlers(): void {
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "codeforces://users",
          name: "Codeforces Users",
          description: "Access to Codeforces user information (MongoDB-cached)",
          mimeType: "application/json",
        },
        {
          uri: "codeforces://contests",
          name: "Codeforces Contests",
          description: "Access to Codeforces contest information",
          mimeType: "application/json",
        },
        {
          uri: "codeforces://problems",
          name: "Codeforces Problems",
          description: "Access to Codeforces problem information",
          mimeType: "application/json",
        },
      ],
    }));

    this.mcpServer.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;
        const resourceInfo: Record<string, object> = {
          "codeforces://users": {
            description: "Codeforces user data (MongoDB-cached, 24 h TTL)",
            available_operations: [
              "get_user_info",
              "get_user_submissions",
              "get_user_rating",
              "predict_future_rating",
            ],
          },
          "codeforces://contests": {
            description: "Codeforces contest data",
            available_operations: ["get_contest_list", "get_contest_standings"],
          },
          "codeforces://problems": {
            description: "Codeforces problem data",
            available_operations: ["get_problems"],
          },
        };
        const info = resourceInfo[uri];
        if (!info) throw new Error(`Unknown resource: ${uri}`);
        return {
          contents: [
            { uri, mimeType: "application/json", text: JSON.stringify(info, null, 2) },
          ],
        };
      }
    );

    // ── Tool Definitions ──────────────────────────────────────────────────────

    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_user_info",
          description:
            "Get information about Codeforces users. Results are cached in MongoDB for 24 hours.",
          inputSchema: {
            type: "object",
            properties: {
              handles: {
                type: "array",
                items: { type: "string" },
                description: "List of user handles",
              },
            },
            required: ["handles"],
          },
        },
        {
          name: "get_user_submissions",
          description: "Get recent submissions for a user",
          inputSchema: {
            type: "object",
            properties: {
              handle: { type: "string", description: "User handle" },
              count: {
                type: "number",
                description: "Number of submissions to retrieve",
                default: 10,
              },
            },
            required: ["handle"],
          },
        },
        {
          name: "get_user_rating",
          description:
            "Get rating history for a user. Results are cached in MongoDB for 24 hours.",
          inputSchema: {
            type: "object",
            properties: {
              handle: { type: "string", description: "User handle" },
            },
            required: ["handle"],
          },
        },
        {
          name: "get_contest_list",
          description: "Get list of contests",
          inputSchema: {
            type: "object",
            properties: {
              gym: {
                type: "boolean",
                description: "Include gym contests",
                default: false,
              },
            },
          },
        },
        {
          name: "get_contest_standings",
          description: "Get contest standings",
          inputSchema: {
            type: "object",
            properties: {
              contest_id: { type: "number", description: "Contest ID" },
              count: {
                type: "number",
                description: "Number of participants to retrieve",
                default: 10,
              },
            },
            required: ["contest_id"],
          },
        },
        {
          name: "get_problems",
          description: "Get problems from problemset",
          inputSchema: {
            type: "object",
            properties: {
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Problem tags to filter by",
              },
            },
          },
        },
        {
          name: "predict_future_rating",
          description:
            "Use a TensorFlow neural network to predict a user's next Codeforces contest rating based on their historical ratings.",
          inputSchema: {
            type: "object",
            properties: {
              handle: {
                type: "string",
                description: "Codeforces user handle",
              },
            },
            required: ["handle"],
          },
        },
      ],
    }));

    // ── Tool Execution ────────────────────────────────────────────────────────

    this.mcpServer.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;

        try {
          switch (name) {
            case "get_user_info": {
              const handles = args?.handles as string[];
              if (!handles || !Array.isArray(handles))
                throw new Error(
                  "handles parameter is required and must be an array"
                );
              const result = await this.api.getUserInfo(handles);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }

            case "get_user_submissions": {
              const handle = args?.handle as string;
              const count = (args?.count as number) || 10;
              if (!handle) throw new Error("handle parameter is required");
              const result = await this.api.getUserStatus(handle, 1, count);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }

            case "get_user_rating": {
              const handle = args?.handle as string;
              if (!handle) throw new Error("handle parameter is required");
              const result = await this.api.getUserRating(handle);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }

            case "get_contest_list": {
              const gym = (args?.gym as boolean) || false;
              const result = await this.api.getContestList(gym);
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result.slice(0, 20), null, 2),
                  },
                ],
              };
            }

            case "get_contest_standings": {
              const contestId = args?.contest_id as number;
              const count = (args?.count as number) || 10;
              if (!contestId) throw new Error("contest_id parameter is required");
              const result = await this.api.getContestStandings(
                contestId,
                1,
                count
              );
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }

            case "get_problems": {
              const tags = (args?.tags as string[]) || [];
              const result = (await this.api.getProblemsFromProblemset(tags)) as {
                problems?: unknown[];
                problemStatistics?: unknown[];
              };
              if (result.problems) result.problems = result.problems.slice(0, 50);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            }

            case "predict_future_rating": {
              const handle = args?.handle as string;
              if (!handle) throw new Error("handle parameter is required");

              // Fetch rating history (uses MongoDB cache)
              const ratingHistory = await this.api.getUserRating(handle);
              if (ratingHistory.length === 0) {
                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        handle,
                        error: "No rating history found for this user.",
                      }),
                    },
                  ],
                };
              }

              // Extract the newRating values as the input sequence
              const ratings = ratingHistory.map((r) => r.newRating);

              // Call the Python/TensorFlow predictor
              const prediction = await runPythonPredictor(ratings);

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        handle,
                        total_contests: ratingHistory.length,
                        current_rating: ratings[ratings.length - 1],
                        rating_history: ratings,
                        prediction,
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }

            default:
              throw new Error(`Unknown tool: ${name}`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
          };
        }
      }
    );
  }
}

// ─── Express App + SSE Transport ──────────────────────────────────────────────

async function main() {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Create the MCP server instance
  const cfServer = new CodeforcesServer();
  const mcpServer = cfServer.getMcpServer();

  // 3. Build Express app
  const app = express();
  app.use(express.json());

  // Health check endpoint (required for Cloud Run)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "codeforces-ai-analytics-server" });
  });

  // Keep a map of active SSE transports so we can route POST /messages
  // back to the correct session.
  const transports = new Map<string, SSEServerTransport>();

  /**
   * GET /sse  — clients connect here to open the SSE stream.
   * The MCP SDK takes over and streams JSON-RPC messages.
   */
  app.get("/sse", async (req, res) => {
    console.log("📡 New SSE connection from", req.ip);

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    res.on("close", () => {
      console.log(`🔌 SSE connection closed: ${sessionId}`);
      transports.delete(sessionId);
    });

    await mcpServer.connect(transport);
  });

  /**
   * POST /messages  — clients send JSON-RPC requests here.
   * The sessionId query param identifies which SSE stream to reply on.
   */
  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: `No active SSE session: ${sessionId}` });
      return;
    }

    // Cast to raw Node.js http types which the SDK v0.4.0 transport expects
    await transport.handlePostMessage(
      req as unknown as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse
    );
  });

  // 4. Start listening
  const PORT = parseInt(process.env.PORT ?? "8080", 10);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀  Codeforces AI Analytics Server running`);
    console.log(`   HTTP  : http://0.0.0.0:${PORT}`);
    console.log(`   SSE   : http://0.0.0.0:${PORT}/sse`);
    console.log(`   POST  : http://0.0.0.0:${PORT}/messages`);
    console.log(`   Health: http://0.0.0.0:${PORT}/health\n`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});