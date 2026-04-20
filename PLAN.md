# Plan: Orchestrama

## Goals

Orchestrama bridges AI orchestrators (Kiro, Claude Desktop, Cursor) with a local Ollama instance via the Model Context Protocol (MCP). Its purpose is to enable AI assistants to leverage local LLMs for context-aware tasks while maintaining control over resource usage.

### Core Objectives

1. **Local LLM Integration** - Connect AI orchestrators to local Ollama models without cloud dependencies
2. **Context-Aware Processing** - Enable AI assistants to process local files with appropriate context windows
3. **Resource Management** - Provide tools to benchmark models, manage memory usage, and optimize performance
4. **Flexible Routing** - Route different task types to specialized models via capability mapping
5. **Human Oversight** - Provide an interactive console for operators to manage configuration and monitor usage

### Key Capabilities

- **MCP Server Interface** - Expose tools for AI clients: query models, ping status, list/register intent patterns, get limits, setup configuration
- **Human Console** - Interactive CLI for managing models, running benchmarks, editing limits, viewing stats
- **Benchmark Advisor** - Automated wizard to detect hardware, filter models by memory budget, benchmark candidates, recommend optimal configuration
- **Intent Patterns** - Built-in and custom system prompts for code review, bug finding, summarization, log analysis, test generation
- **Dynamic Directories** - Manage allowed file access paths at runtime with security boundaries

### Target Users

- **AI Orchestrators** - Kiro, Claude Desktop, Cursor users who want local LLM integration
- **Operators** - Developers and teams managing local Ollama instances
- **Data Scientists** - Users who need to benchmark and select optimal models for their hardware
