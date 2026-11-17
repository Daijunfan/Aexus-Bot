import type { FilterGroup, JsonBlock } from '../types';
import type { RepeatRule } from '../scheduling/types';
export type ActionValue = unknown;
export type ValueOperation = 'set' | 'add' | 'remove' | 'clear' | 'toggle';
export type ActionStep = {
  id: string;
  type: 'set' | 'create' | 'edit' | 'insert' | 'notify' | 'reminder' | 'variable' | 'open' | 'trash' | 'agent' | 'mission' | 'schedule';
  target?: string;
  databaseId?: string;
  templateId?: string;
  title?: ActionValue;
  values?: Record<string, ActionValue>;
  operations?: Record<string, ValueOperation>;
  filters?: FilterGroup;
  filterFormula?: string;
  blocks?: JsonBlock[];
  position?: 'start' | 'end' | 'beforeButton' | 'afterButton';
  text?: ActionValue;
  at?: ActionValue;
  name?: string;
  value?: ActionValue;
  mode?: 'full' | 'side' | 'center';
  // Aexus Bot workflow extensions
  employeeId?: string;
  employeeIds?: string[];
  prompt?: ActionValue;
  deliveryMode?: 'direct' | 'session';
  grantPageAccess?: 'none' | 'read' | 'write' | 'create';
  missionType?: 'supervised' | 'independent';
  reminderSeconds?: number;
  scheduleKind?: 'once' | 'interval' | 'weekly' | 'event';
  scheduleAt?: ActionValue;
  everySeconds?: number;
  weeklyTime?: string;
  weeklyDays?: number[];
  eventName?: 'signal' | 'channel.posted' | 'message.received' | 'session.completed';
};
export type ButtonConfig = { label?: string; confirmation?: string; actions: ActionStep[] };
export type AutomationTrigger = { id: string; type: 'created' | 'property'; propertyId?: string };
export type DatabaseAutomation = {
  id: string;
  name: string;
  enabled: boolean;
  disabledReason?: string;
  triggers: AutomationTrigger[];
  triggerMode?: 'any' | 'all';
  filters?: FilterGroup;
  viewId?: string;
  actions: ActionStep[];
  schedule?: RepeatRule;
};
export type ActionRun = {
  id: string;
  at: number;
  kind: 'button' | 'automation';
  name: string;
  ownerId: string;
  sourceId: string;
  status: 'success' | 'error';
  error?: string;
  steps?: { id: string; type: string; result: unknown }[];
  scheduledFor?: string;
};
export type ActionEffect =
  | { type: 'open'; pageId: string; mode?: 'full' | 'side' | 'center' }
  | {
      type: 'agent_dispatch';
      stepId: string;
      pageId: string;
      pageTitle: string;
      employeeId: string;
      deliveryMode: 'direct' | 'session';
      grantPageAccess: 'none' | 'read' | 'write' | 'create';
      prompt: string;
    }
  | {
      type: 'mission_create';
      stepId: string;
      pageId: string;
      pageTitle: string;
      name: string;
      prompt: string;
      employeeIds: string[];
      missionType: 'supervised' | 'independent';
      reminderSeconds: number;
      grantPageAccess: 'none' | 'read' | 'write' | 'create';
    }
  | {
      type: 'schedule_create';
      stepId: string;
      pageId: string;
      pageTitle: string;
      name: string;
      prompt: string;
      employeeId: string;
      scheduleKind: 'once' | 'interval' | 'weekly' | 'event';
      scheduleAt?: string;
      everySeconds?: number;
      weeklyTime?: string;
      weeklyDays?: number[];
      eventName?: string;
      grantPageAccess: 'none' | 'read' | 'write' | 'create';
    };
