# Codeforces MCP Server

A Model Context Protocol (MCP) server that provides access to Codeforces data through a standardized interface. This server allows you to query user information, contest data, problem submissions, and more from the Codeforces platform.

## Features

- **User Information**: Get detailed information about Codeforces users including ratings, rankings, and profiles
- **Submissions**: Retrieve recent submissions for any user with detailed verdict and performance data
- **Rating History**: Access complete rating change history for users
- **Contest Data**: Get information about contests including standings and participant data
- **Problem Sets**: Query problems from the Codeforces problemset with filtering capabilities
- **Real-time Data**: All data is fetched directly from the official Codeforces API

## Installation

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn package manager

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/codeforces-mcp-server.git
cd codeforces-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Make the script executable:
```bash
chmod +x index.js
```

## Usage

### Running the Server

The server runs on stdio transport and can be started with:

```bash
./index.js
```

Or using Node.js directly:

```bash
node index.js
```

### Available Tools

The server provides the following tools through the MCP interface:

#### 1. Get User Information
```javascript
{
  "name": "get_user_info",
  "arguments": {
    "handles": ["tourist", "jiangly", "Benq"]
  }
}
```

#### 2. Get User Submissions
```javascript
{
  "name": "get_user_submissions",
  "arguments": {
    "handle": "tourist",
    "count": 20
  }
}
```

#### 3. Get User Rating History
```javascript
{
  "name": "get_user_rating",
  "arguments": {
    "handle": "tourist"
  }
}
```

#### 4. Get Contest List
```javascript
{
  "name": "get_contest_list",
  "arguments": {
    "gym": false
  }
}
```

#### 5. Get Contest Standings
```javascript
{
  "name": "get_contest_standings",
  "arguments": {
    "contest_id": 1234,
    "count": 50
  }
}
```

#### 6. Get Problems
```javascript
{
  "name": "get_problems",
  "arguments": {
    "tags": ["dp", "graphs", "implementation"]
  }
}
```

### Available Resources

The server exposes three main resources:

- `codeforces://users` - User-related operations
- `codeforces://contests` - Contest-related operations  
- `codeforces://problems` - Problem-related operations

## API Reference

### User Operations

- **Get User Info**: Retrieve detailed information about one or more users
- **Get User Submissions**: Get recent submissions with verdicts and performance metrics
- **Get User Rating**: Access complete rating change history

### Contest Operations

- **Get Contest List**: List all contests (with optional gym filter)
- **Get Contest Standings**: Retrieve standings for a specific contest

### Problem Operations

- **Get Problems**: Query problems from the problemset with optional tag filtering

## Configuration

The server includes built-in configuration:

- **Timeout**: 10 seconds for API requests
- **Rate Limiting**: Respects Codeforces API rate limits
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Response Limiting**: Automatic limiting of large responses to prevent timeouts

## Error Handling

The server includes robust error handling for:

- Network connectivity issues
- Invalid API responses
- Missing required parameters
- Rate limit exceeded
- Invalid user handles or contest IDs

## Examples

### Getting User Information
```bash
# Example response for user info
{
  "handle": "tourist",
  "rating": 3821,
  "maxRating": 4229,
  "rank": "legendary grandmaster",
  "maxRank": "legendary grandmaster",
  "country": "Belarus",
  "contribution": 118,
  "friendOfCount": 25234
}
```

### Getting Recent Submissions
```bash
# Example response for submissions
{
  "id": 123456789,
  "contestId": 1234,
  "problem": {
    "name": "Problem A",
    "index": "A",
    "rating": 800,
    "tags": ["implementation", "math"]
  },
  "verdict": "OK",
  "programmingLanguage": "GNU C++17",
  "timeConsumedMillis": 31,
  "memoryConsumedBytes": 1024000
}
```

## Dependencies

- `@modelcontextprotocol/sdk`: MCP SDK for server implementation
- `axios`: HTTP client for API requests

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built using the [Model Context Protocol](https://github.com/modelcontextprotocol/specification)
- Data provided by the [Codeforces API](https://codeforces.com/apiHelp)

## Support

For issues and questions:
- Open an issue on GitHub
- Check the [Codeforces API documentation](https://codeforces.com/apiHelp)
- Review the [MCP specification](https://github.com/modelcontextprotocol/specification)

## Changelog

### v1.0.0
- Initial release with full Codeforces API integration
- Support for user, contest, and problem data
- Comprehensive error handling and rate limiting
