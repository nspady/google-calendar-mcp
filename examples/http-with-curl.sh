#!/bin/bash

# Test script for Google Calendar MCP Server HTTP mode using curl
# This demonstrates basic HTTP requests to test the MCP server

SERVER_URL="${1:-http://localhost:3000}"
SESSION_ID="curl-test-session-$(date +%s)"

echo "🚀 Testing Google Calendar MCP Server at: $SERVER_URL"
echo "🆔 Using session ID: $SESSION_ID"
echo "=================================================="

# Test 1: Health check
echo -e "\n🏥 Testing health endpoint..."
curl -s "$SERVER_URL/health" | jq '.' || echo "Health check failed"

# Test 2: Initialize MCP session
echo -e "\n🤝 Testing MCP initialize..."

# MCP Initialize request
INIT_REQUEST='{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "clientInfo": {
      "name": "curl-test-client",
      "version": "1.0.0"
    }
  }
}'

echo "Sending initialize request..."
INIT_RESPONSE=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d "$INIT_REQUEST")

echo "Raw response:"
echo "$INIT_RESPONSE"
echo ""

# Try to parse as JSON, if that fails, check if it's SSE format
if echo "$INIT_RESPONSE" | jq '.' >/dev/null 2>&1; then
  echo "✅ JSON response:"
  echo "$INIT_RESPONSE" | jq '.'
elif echo "$INIT_RESPONSE" | grep -q "^data:"; then
  echo "📡 SSE response detected, extracting JSON:"
  echo "$INIT_RESPONSE" | grep "^data:" | sed 's/^data: //' | jq '.'
else
  echo "❌ Unknown response format"
fi

# Check if initialization was successful
if echo "$INIT_RESPONSE" | grep -q "result\|initialize"; then
  echo "✅ Initialization successful"
else
  echo "❌ Initialization failed - stopping tests"
  exit 1
fi

# Test 3: List Tools request (after successful initialization)
echo -e "\n📋 Testing list tools..."
LIST_TOOLS_REQUEST='{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}'

TOOLS_RESPONSE=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d "$LIST_TOOLS_REQUEST")

echo "Raw response:"
echo "$TOOLS_RESPONSE"
echo ""

# Parse response appropriately
if echo "$TOOLS_RESPONSE" | jq '.' >/dev/null 2>&1; then
  echo "✅ JSON response:"
  echo "$TOOLS_RESPONSE" | jq '.'
elif echo "$TOOLS_RESPONSE" | grep -q "^data:"; then
  echo "📡 SSE response detected, extracting JSON:"
  echo "$TOOLS_RESPONSE" | grep "^data:" | sed 's/^data: //' | jq '.'
else
  echo "❌ List tools failed - unknown format"
fi

# Test 4: Call list-calendars tool
echo -e "\n📅 Testing list-calendars tool..."

LIST_CALENDARS_REQUEST='{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "list-calendars",
    "arguments": {}
  }
}'

CALENDARS_RESPONSE=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d "$LIST_CALENDARS_REQUEST")

echo "Raw response:"
echo "$CALENDARS_RESPONSE"
echo ""

# Parse response appropriately
if echo "$CALENDARS_RESPONSE" | jq '.' >/dev/null 2>&1; then
  echo "✅ JSON response:"
  echo "$CALENDARS_RESPONSE" | jq '.' | head -20
  echo "..."
elif echo "$CALENDARS_RESPONSE" | grep -q "^data:"; then
  echo "📡 SSE response detected, extracting JSON:"
  echo "$CALENDARS_RESPONSE" | grep "^data:" | sed 's/^data: //' | jq '.' | head -20
  echo "..."
else
  echo "❌ List calendars failed - unknown format"
fi

# Test 5: Call list-colors tool
echo -e "\n🎨 Testing list-colors tool..."

LIST_COLORS_REQUEST='{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "list-colors",
    "arguments": {}
  }
}'

COLORS_RESPONSE=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d "$LIST_COLORS_REQUEST")

echo "Raw response:"
echo "$COLORS_RESPONSE"
echo ""

# Parse response appropriately
if echo "$COLORS_RESPONSE" | jq '.' >/dev/null 2>&1; then
  echo "✅ JSON response:"
  echo "$COLORS_RESPONSE" | jq '.'
elif echo "$COLORS_RESPONSE" | grep -q "^data:"; then
  echo "📡 SSE response detected, extracting JSON:"
  echo "$COLORS_RESPONSE" | grep "^data:" | sed 's/^data: //' | jq '.'
else
  echo "❌ List colors failed - unknown format"
fi

echo -e "\n✅ HTTP testing completed!"
echo -e "\n💡 To test with different server URL: $0 http://your-server:port"