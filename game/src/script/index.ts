/** Motor de script das missões. Ponto de entrada para a frente MISSÃO (ver docs/SCRIPT_HOST.md). */
export * from "./host";
export * from "./types";
export { parseScript, fetchScript, ScriptFormatError, type ParseOptions } from "./loader";
export { ScriptRuntime, compare, type RuntimeOptions, type ScriptEvent, type ScriptOutcome, type ScriptRuntimeState, type DistanceMetric } from "./runtime";
