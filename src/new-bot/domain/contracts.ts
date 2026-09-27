/** Untrusted model output: an intent and entity proposal, never an executable operation. */
export interface IntentProposal {
  readonly intent: string;
  readonly entities: Readonly<Record<string, unknown>>;
  readonly confidence?: number;
}

/** A capability-backed operation declared for deterministic domain handling. */
export interface DomainOperation {
  readonly intent: string;
  readonly capability: string;
  readonly requiredEntities: readonly string[];
}

export interface VerticalContract {
  readonly vertical: string;
  readonly capabilities: readonly string[];
  readonly operations: readonly DomainOperation[];
}