#!/usr/bin/env node
/**
 * Codeforces MCP Server
 *
 * This server provides access to Codeforces data through the Model Context Protocol.
 * It allows querying user information, contest data, and problem submissions.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
class CodeforcesAPI {
    baseUrl = "https://codeforces.com/api";
    httpClient;
    constructor() {
        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                "User-Agent": "Codeforces-MCP-Server/1.0.0",
            },
        });
    }
    async makeRequest(endpoint, params = {}) {
        try {
            const response = await this.httpClient.get(endpoint, { params });
            if (response.data.status !== "OK") {
                throw new Error(`API Error: ${response.data.comment || "Unknown error"}`);
            }
            return response.data.result;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Request failed: ${error.message}`);
            }
            throw error;
        }
    }
    async getUserInfo(handles) {
        return this.makeRequest("user.info", {
            handles: handles.join(";"),
        });
    }
    async getUserStatus(handle, from = 1, count = 10) {
        return this.makeRequest("user.status", {
            handle,
            from,
            count,
        });
    }
    async getUserRating(handle) {
        return this.makeRequest("user.rating", {
            handle,
        });
    }
    async getContestList(gym = false) {
        return this.makeRequest("contest.list", { gym });
    }
    async getContestStandings(contestId, from = 1, count = 10) {
        return this.makeRequest("contest.standings", {
            contestId,
            from,
            count,
        });
    }
    async getProblemsFromProblemset(tags = []) {
        const params = {};
        if (tags.length > 0) {
            params.tags = tags.join(";");
        }
        return this.makeRequest("problemset.problems", params);
    }
}
class CodeforcesServer {
    server;
    api;
    constructor() {
        this.server = new Server({
            name: "codeforces-mcp",
            version: "1.0.0",
        }, {
            capabilities: {
                resources: {},
                tools: {},
            },
        });
        this.api = new CodeforcesAPI();
        this.setupHandlers();
    }
    setupHandlers() {
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    {
                        uri: "codeforces://users",
                        name: "Codeforces Users",
                        description: "Access to Codeforces user information",
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
            };
        });
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;
            switch (uri) {
                case "codeforces://users":
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: "application/json",
                                text: JSON.stringify({
                                    description: "Codeforces user data access",
                                    available_operations: [
                                        "get_user_info",
                                        "get_user_submissions",
                                        "get_user_rating",
                                    ],
                                }, null, 2),
                            },
                        ],
                    };
                case "codeforces://contests":
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: "application/json",
                                text: JSON.stringify({
                                    description: "Codeforces contest data access",
                                    available_operations: [
                                        "get_contest_list",
                                        "get_contest_standings",
                                    ],
                                }, null, 2),
                            },
                        ],
                    };
                case "codeforces://problems":
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: "application/json",
                                text: JSON.stringify({
                                    description: "Codeforces problem data access",
                                    available_operations: [
                                        "get_problems",
                                    ],
                                }, null, 2),
                            },
                        ],
                    };
                default:
                    throw new Error(`Unknown resource: ${uri}`);
            }
        });
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "get_user_info",
                        description: "Get information about Codeforces users",
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
                                handle: {
                                    type: "string",
                                    description: "User handle",
                                },
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
                        description: "Get rating history for a user",
                        inputSchema: {
                            type: "object",
                            properties: {
                                handle: {
                                    type: "string",
                                    description: "User handle",
                                },
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
                                contest_id: {
                                    type: "number",
                                    description: "Contest ID",
                                },
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
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case "get_user_info": {
                        const handles = args?.handles;
                        if (!handles || !Array.isArray(handles)) {
                            throw new Error("handles parameter is required and must be an array");
                        }
                        const result = await this.api.getUserInfo(handles);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }
                    case "get_user_submissions": {
                        const handle = args?.handle;
                        const count = args?.count || 10;
                        if (!handle) {
                            throw new Error("handle parameter is required");
                        }
                        const result = await this.api.getUserStatus(handle, 1, count);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }
                    case "get_user_rating": {
                        const handle = args?.handle;
                        if (!handle) {
                            throw new Error("handle parameter is required");
                        }
                        const result = await this.api.getUserRating(handle);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }
                    case "get_contest_list": {
                        const gym = args?.gym || false;
                        const result = await this.api.getContestList(gym);
                        // Limit to 20 contests to avoid huge responses
                        const limitedResult = result.slice(0, 20);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(limitedResult, null, 2),
                                },
                            ],
                        };
                    }
                    case "get_contest_standings": {
                        const contestId = args?.contest_id;
                        const count = args?.count || 10;
                        if (!contestId) {
                            throw new Error("contest_id parameter is required");
                        }
                        const result = await this.api.getContestStandings(contestId, 1, count);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }
                    case "get_problems": {
                        const tags = args?.tags || [];
                        const result = await this.api.getProblemsFromProblemset(tags);
                        // Limit problems to avoid huge responses
                        if (result.problems) {
                            result.problems = result.problems.slice(0, 50);
                        }
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: ${errorMessage}`,
                        },
                    ],
                };
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Codeforces MCP Server running on stdio");
    }
}
// Run the server
const server = new CodeforcesServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map