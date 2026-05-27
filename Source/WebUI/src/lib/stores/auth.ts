import { writable, get } from 'svelte/store';
import {
	getAuthMethods,
	startAgentLogin,
	onLoginComplete,
	getAgentLogoutSupport,
	startAgentLogout
} from '$lib/bridge.js';

export type AuthState = 'none' | 'required' | 'logging_in' | 'success' | 'error';

/** Whether the current agent requires authentication */
export const authState = writable<AuthState>('none');

/** Which agent needs authentication */
export const authAgentName = writable<string>('');

/** Error message from failed login */
export const authError = writable<string>('');

/** Called when we detect error code -32000 from the adapter */
export function setAuthRequired(agentName: string, reason = ''): void {
	authAgentName.set(agentName);
	authError.set(reason);
	authState.set('required');
}

/** Start login flow for an explicit agent name */
export async function startLoginForAgent(agentName: string): Promise<void> {
	if (!agentName) return;

	authAgentName.set(agentName);
	authState.set('logging_in');
	authError.set('');

	try {
		const methods = await getAuthMethods(agentName);
		const validMethods = methods.filter((m) => typeof m.id === 'string' && m.id.trim().length > 0);
		if (validMethods.length === 0) {
			authState.set('error');
			authError.set('No valid authentication methods available for this agent.');
			return;
		}

		const containsAny = (value: string, tokens: string[]): boolean => {
			const lower = value.toLowerCase();
			return tokens.some((token) => lower.includes(token));
		};

		const browserHintTokens = ['chatgpt', 'subscription', 'oauth', 'login', 'sign in', 'openai-codex'];
		const apiKeyTokens = ['api key', 'apikey', 'token', 'openai_api_key', 'codex_api_key', 'env_var'];

		const ranked = [...validMethods].sort((a, b) => {
			const score = (m: (typeof validMethods)[number]): number => {
				const id = (m.id || '').toLowerCase();
				const name = (m.name || '').toLowerCase();
				const type = ((m as { type?: string }).type || '').toLowerCase();

				if (id === 'chatgpt') return 1000;
				if (id === 'openai-codex' || id === 'openai_codex') return 950;

				const browserHint = containsAny(id, browserHintTokens) || containsAny(name, browserHintTokens);
				const apiKeyHint = containsAny(id, apiKeyTokens) || containsAny(name, apiKeyTokens) || type === 'env_var';

				if (browserHint && !apiKeyHint) return 900;
				if (!apiKeyHint) return 700;
				return 100;
			};
			return score(b) - score(a);
		});

		const preferred = ranked[0];
		await startAgentLogin(agentName, preferred.id);
	} catch (e) {
		authState.set('error');
		authError.set(e instanceof Error ? e.message : 'Failed to start login');
	}
}

/** Start the agent login flow — prefer ChatGPT website auth when available */
export async function startLogin(): Promise<void> {
	const agentName = get(authAgentName);
	if (!agentName) return;
	await startLoginForAgent(agentName);
}

/** Request logout support/capability for an agent */
export async function getLogoutSupportForAgent(agentName: string): Promise<{ supported: boolean; commandPreview?: string; reason?: string }> {
	return getAgentLogoutSupport(agentName);
}

/** Start logout flow for an agent */
export async function logoutAgent(agentName: string): Promise<{ success: boolean; error?: string }> {
	return startAgentLogout(agentName);
}

/** Bind the login completion callback — call once on mount */
export function bindLoginListener(): void {
	onLoginComplete((agentName, success, errorMessage) => {
		// Only process if this is for the agent we're currently authenticating
		const currentAgent = get(authAgentName);
		if (currentAgent && agentName !== currentAgent) return;

		if (success) {
			authState.set('success');
			authError.set('');
			// Auto-dismiss after a moment so the UI returns to normal
			setTimeout(() => {
				authState.set('none');
				authAgentName.set('');
			}, 2500);
		} else {
			authState.set('error');
			authError.set(errorMessage || 'Login failed');
		}
	});
}

/** Reset auth state (call when switching sessions/agents) */
export function resetAuth(): void {
	authState.set('none');
	authAgentName.set('');
	authError.set('');
}
