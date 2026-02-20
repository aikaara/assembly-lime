/**
 * Subagent tool — spawn specialized sub-agents sharing the same workspace.
 * Supports single, parallel, and chain execution modes.
 */

import { Agent, type AgentTool, type AgentToolResult } from "@assembly-lime/pi-agent";
import { getEnvApiKey, getModel, type Model } from "@assembly-lime/pi-ai";
import type { OperationsBundle } from "@assembly-lime/pi-coding-agent-tools";
import type { DaytonaWorkspace } from "@assembly-lime/shared";
import { Type } from "@sinclair/typebox";
import { convertToLlm } from "../agent/convert-to-llm.js";

// ── Predefined agent configs ─────────────────────────────────────────

interface SubagentConfig {
	description: string;
	model: { provider: string; modelId: string };
	toolNames: string[];
	systemPromptSuffix: string;
}

const SUBAGENT_CONFIGS: Record<string, SubagentConfig> = {
	scout: {
		description: "Fast codebase reconnaissance with read-only tools",
		model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
		toolNames: ["read", "grep", "find", "ls", "bash"],
		systemPromptSuffix:
			"You are a scout agent. Quickly explore the codebase and report your findings concisely. Do NOT make any changes.",
	},
	planner: {
		description: "Create implementation plans with read-only tools",
		model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
		toolNames: ["read", "grep", "find", "ls", "bash"],
		systemPromptSuffix:
			"You are a planning agent. Analyze the codebase and produce a detailed, step-by-step implementation plan. Do NOT make any changes.",
	},
	worker: {
		description: "Implement changes with full tool set",
		model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
		toolNames: ["read", "write", "edit", "bash", "grep", "find", "ls", "git_status", "git_diff"],
		systemPromptSuffix:
			"You are a worker agent. Implement the requested changes precisely and efficiently. Focus on code quality.",
	},
	reviewer: {
		description: "Review code with read-only tools + bash for running tests",
		model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
		toolNames: ["read", "bash", "grep", "find", "ls", "git_status", "git_diff"],
		systemPromptSuffix:
			"You are a code review agent. Examine the code for bugs, security issues, and style problems. Run tests if applicable.",
	},
};

// ── Schema ────────────────────────────────────────────────────────────

const SubagentStep = Type.Object({
	agent: Type.String({
		description: `Agent type: ${Object.entries(SUBAGENT_CONFIGS)
			.map(([k, v]) => `"${k}" (${v.description})`)
			.join(", ")}`,
	}),
	task: Type.String({ description: "Task prompt for the agent. In chain mode, use {previous} to reference prior output." }),
});

const subagentParams = Type.Object({
	mode: Type.Union(
		[Type.Literal("single"), Type.Literal("parallel"), Type.Literal("chain")],
		{ description: "Execution mode: single (one agent), parallel (up to 4 concurrent), chain (sequential with {previous} output)" },
	),
	steps: Type.Array(SubagentStep, {
		description: "Agent steps to execute. Single mode: 1 step. Parallel: up to 4. Chain: sequential steps.",
		minItems: 1,
		maxItems: 4,
	}),
});

// ── Factory ───────────────────────────────────────────────────────────

export interface SubagentToolOptions {
	allTools: Map<string, AgentTool<any>>;
	cwd: string;
	workspace?: DaytonaWorkspace;
	onProgress?: (agentName: string, message: string) => void;
}

export function createSubagentTool(options: SubagentToolOptions): AgentTool<typeof subagentParams> {
	const { allTools, cwd, workspace, onProgress } = options;

	function resolveToolsForConfig(config: SubagentConfig): AgentTool<any>[] {
		return config.toolNames
			.map((name) => allTools.get(name))
			.filter((t): t is AgentTool<any> => t !== undefined);
	}

	function resolveModel(config: SubagentConfig): Model<any> {
		return getModel(config.model.provider, config.model.modelId);
	}

	async function runSubagent(
		config: SubagentConfig,
		agentName: string,
		task: string,
	): Promise<string> {
		const tools = resolveToolsForConfig(config);
		const model = resolveModel(config);

		const workspaceCtx = workspace
			? `\n\nYou are operating inside a shared Daytona sandbox (${workspace.sandbox.id}). ` +
				`The repository is cloned at: ${workspace.repoDir}. ` +
				`All file and shell operations execute inside this sandbox.`
			: "";

		const systemPrompt = `${config.systemPromptSuffix}\n\nWorking directory: ${cwd}${workspaceCtx}`;

		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "low",
				tools,
				messages: [],
			},
			convertToLlm,
			getApiKey: (provider) => getEnvApiKey(provider),
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
		});

		// Stream progress
		const unsubscribe = agent.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				// Don't flood — emit periodically
			} else if (event.type === "tool_execution_start") {
				onProgress?.(agentName, `[${agentName}] using ${event.toolName}`);
			}
		});

		try {
			onProgress?.(agentName, `[${agentName}] starting: ${task.slice(0, 100)}...`);
			await agent.prompt(task);
			await agent.waitForIdle();

			// Extract final assistant text
			const messages = agent.state.messages;
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") as any;
			const textContent = lastAssistant?.content
				?.filter((c: any) => c.type === "text")
				?.map((c: any) => c.text)
				?.join("\n") ?? "(no output)";

			onProgress?.(agentName, `[${agentName}] completed`);
			return textContent;
		} finally {
			unsubscribe();
		}
	}

	return {
		name: "subagent",
		label: "Sub-agent",
		description: `Spawn specialized sub-agents for complex tasks. Available agents: ${Object.entries(SUBAGENT_CONFIGS)
			.map(([k, v]) => `${k} (${v.description})`)
			.join("; ")}. Modes: single (1 agent), parallel (up to 4 concurrent), chain (sequential with {previous} placeholder for prior output).`,
		parameters: subagentParams,
		async execute(
			_toolCallId: string,
			params: { mode: "single" | "parallel" | "chain"; steps: Array<{ agent: string; task: string }> },
			signal?: AbortSignal,
		): Promise<AgentToolResult<{ outputs: string[] }>> {
			const outputs: string[] = [];

			for (const step of params.steps) {
				if (!SUBAGENT_CONFIGS[step.agent]) {
					throw new Error(
						`Unknown agent type: ${step.agent}. Available: ${Object.keys(SUBAGENT_CONFIGS).join(", ")}`,
					);
				}
			}

			if (params.mode === "single") {
				const step = params.steps[0];
				const config = SUBAGENT_CONFIGS[step.agent];
				const result = await runSubagent(config, step.agent, step.task);
				outputs.push(result);
			} else if (params.mode === "parallel") {
				const results = await Promise.all(
					params.steps.map((step) => {
						const config = SUBAGENT_CONFIGS[step.agent];
						return runSubagent(config, step.agent, step.task);
					}),
				);
				outputs.push(...results);
			} else if (params.mode === "chain") {
				let previousOutput = "";
				for (const step of params.steps) {
					if (signal?.aborted) throw new Error("Operation aborted");
					const config = SUBAGENT_CONFIGS[step.agent];
					const task = step.task.replace(/\{previous\}/g, previousOutput);
					const result = await runSubagent(config, step.agent, task);
					previousOutput = result;
					outputs.push(result);
				}
			}

			const summary = outputs
				.map((output, i) => {
					const step = params.steps[i];
					const truncated = output.length > 2000 ? output.slice(0, 2000) + "\n...(truncated)" : output;
					return `=== ${step.agent} (step ${i + 1}) ===\n${truncated}`;
				})
				.join("\n\n");

			return {
				content: [{ type: "text", text: summary }],
				details: { outputs },
			};
		},
	};
}
