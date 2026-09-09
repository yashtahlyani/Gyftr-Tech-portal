/* ─── Store dispatcher — picks the local (localStorage) or cloud (Supabase)
   backend based on isCloud. isCloud is fixed for the whole session (derived
   from env vars at load), so this branch never flips mid-render. ─── */
import type { Project } from "./types";
import { isCloud } from "./lib";
import * as local from "./localStore";
import * as cloud from "./cloudStore";

export function moveToStage(...args: Parameters<typeof local.moveToStage>) {
  return isCloud ? cloud.moveToStage(...args) : local.moveToStage(...args);
}
export function transition(...args: Parameters<typeof local.transition>) {
  return isCloud ? cloud.transition(...args) : local.transition(...args);
}
export function setStatus(...args: Parameters<typeof local.setStatus>) {
  return isCloud ? cloud.setStatus(...args) : local.setStatus(...args);
}
export function reassign(...args: Parameters<typeof local.reassign>) {
  return isCloud ? cloud.reassign(...args) : local.reassign(...args);
}
export function pickUp(...args: Parameters<typeof local.pickUp>) {
  return isCloud ? cloud.pickUp(...args) : local.pickUp(...args);
}
export function requestClarification(...args: Parameters<typeof local.requestClarification>) {
  return isCloud ? cloud.requestClarification(...args) : local.requestClarification(...args);
}
export function reopen(...args: Parameters<typeof local.reopen>) {
  return isCloud ? cloud.reopen(...args) : local.reopen(...args);
}
export function setBlock(...args: Parameters<typeof local.setBlock>) {
  return isCloud ? cloud.setBlock(...args) : local.setBlock(...args);
}
export function setHold(...args: Parameters<typeof local.setHold>) {
  return isCloud ? cloud.setHold(...args) : local.setHold(...args);
}
export function addComment(...args: Parameters<typeof local.addComment>) {
  return isCloud ? cloud.addComment(...args) : local.addComment(...args);
}
export function resolveNote(...args: Parameters<typeof local.resolveNote>) {
  return isCloud ? cloud.resolveNote(...args) : local.resolveNote(...args);
}
export function addAttachment(...args: Parameters<typeof local.addAttachment>) {
  return isCloud ? cloud.addAttachment(...args) : local.addAttachment(...args);
}
export function toggleSubtask(...args: Parameters<typeof local.toggleSubtask>) {
  return isCloud ? cloud.toggleSubtask(...args) : local.toggleSubtask(...args);
}
export function addSubtask(...args: Parameters<typeof local.addSubtask>) {
  return isCloud ? cloud.addSubtask(...args) : local.addSubtask(...args);
}
export function removeSubtask(...args: Parameters<typeof local.removeSubtask>) {
  return isCloud ? cloud.removeSubtask(...args) : local.removeSubtask(...args);
}
export function reassignSubtask(...args: Parameters<typeof local.reassignSubtask>) {
  return isCloud ? cloud.reassignSubtask(...args) : local.reassignSubtask(...args);
}
export function updateSubtask(...args: Parameters<typeof local.updateSubtask>) {
  return isCloud ? cloud.updateSubtask(...args) : local.updateSubtask(...args);
}
export function updateDetails(...args: Parameters<typeof local.updateDetails>) {
  return isCloud ? cloud.updateDetails(...args) : local.updateDetails(...args);
}
export function setStageTarget(...args: Parameters<typeof local.setStageTarget>) {
  return isCloud ? cloud.setStageTarget(...args) : local.setStageTarget(...args);
}
export function createProject(...args: Parameters<typeof local.createProject>): Promise<Project> {
  return isCloud ? cloud.createProject(...args) : Promise.resolve(local.createProject(...args));
}
export function resetDemo() {
  if (!isCloud) local.resetDemo();
}
export function useProjects(): Project[] {
  return isCloud ? cloud.useProjects() : local.useProjects();
}
