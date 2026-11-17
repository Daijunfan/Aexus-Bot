import fs from 'node:fs';
import path from 'node:path';
import { APP_HOME } from '../shared/core-paths';
import type { PrincipalRef } from '../shared/management';
import { pluginResourceRights, type PluginGrant, type PluginResource } from '../shared/plugin-access';
import { employeeSettings } from '../shared/types';
import { isAppAdministrator, requireAppAdministrator } from './application-authority';
import { atomicJson, readJson } from './atomic-file';
import { listCloudHosts } from './cloud-hosts';
import { emitCoreEvent } from './core-events';
import { requestContext } from './request-context';
import { readStore } from './store';

type AccessState = { version: 1; revision: number; grants: PluginGrant[] };

function accessFile(home = APP_HOME): string {
  return path.join(home, 'host-access.json');
}

function readAccessState(home = APP_HOME): AccessState {
  const file = accessFile(home);
  if (fs.existsSync(file)) {
    return readJson<AccessState>(file, () => ({ version: 1, revision: 0, grants: [] }));
  }
  const legacyPluginFile = path.join(home, 'plugin-access.json');
  if (fs.existsSync(legacyPluginFile)) {
    try {
      const legacy = readJson<Record<string, { plugin?: string; revision?: number; grants?: PluginGrant[] }>>(
        legacyPluginFile,
        () => ({}),
      );
      const merged = new Map<string, PluginGrant>();
      let revision = 0;
      for (const entry of Object.values(legacy)) {
        if (entry?.plugin !== 'cloud-hosts' || !Array.isArray(entry.grants)) continue;
        revision = Math.max(revision, Number(entry.revision) || 0);
        for (const grant of entry.grants) {
          if (!grant?.employeeId || !grant?.resourceId) continue;
          const key = `${grant.employeeId}\0${grant.resourceId}`;
          const prev = merged.get(key);
          merged.set(key, {
            employeeId: grant.employeeId,
            resourceId: grant.resourceId,
            read: Boolean(prev?.read || grant.read),
            write: Boolean(prev?.write || grant.write),
            create: Boolean(prev?.create || grant.create),
          });
        }
      }
      if (merged.size > 0 || revision > 0) {
        const migrated: AccessState = { version: 1, revision: Math.max(1, revision), grants: [...merged.values()] };
        atomicJson(file, migrated, true);
        return migrated;
      }
    } catch {
      /* Preserve empty access state if legacy plugin-access file is unreadable. */
    }
  }
  return { version: 1, revision: 0, grants: [] };
}

function allHostResourceItems(): PluginResource[] {
  return [
    { id: '@root', title: '新增云主机', kind: 'root', capabilities: ['create'] },
    ...listCloudHosts().map((host) => ({
      id: `host:${host.id}`,
      title: `${host.name} (${host.host})`,
      kind: 'host',
      parentId: '@root',
      capabilities: ['read', 'write'] as ('read' | 'write' | 'create')[],
    })),
  ];
}

export function hostRights(id: string, principal: PrincipalRef = requestContext().principal) {
  if (isAppAdministrator(principal)) return { read: true, write: true, create: true };
  if (principal.kind !== 'agent') return { read: false, write: false, create: false };
  const targetResourceId = id === '@root' ? '@root' : `host:${id}`;
  const state = readAccessState();
  const grant = state.grants.find((g) => g.employeeId === principal.employeeId && g.resourceId === targetResourceId);
  if (grant) return { read: grant.read, write: grant.write, create: grant.create };
  const store = readStore();
  const card = store.sessions.find((p) => p.id === principal.employeeId);
  const bound = card && employeeSettings(store, card).hostId === id;
  return { read: !!bound, write: false, create: false };
}

export function hostCommandAllowed(
  command: string,
  args: Record<string, any>,
  principal: PrincipalRef = requestContext().principal,
) {
  if (isAppAdministrator(principal)) return true;
  if (command === 'host.list' || command === 'host.resources') return true;
  if (command === 'host.create') return hostRights('@root', principal).create;
  if (command === 'host.remove' || command === 'host.access') return false;
  const rights = hostRights(String(args.id), principal);
  if (command === 'host.files') {
    const op = String(args.operation ?? 'list');
    return ['list', 'read', 'image', 'info', 'chunk'].includes(op) ? rights.read : rights.write;
  }
  return ['host.get', 'host.check', 'host.directories', 'host.fingerprints'].includes(command) ? rights.read : rights.write;
}

export function grantCreatedHost(employeeId: string, hostId: string): void {
  if (!employeeId || !hostId) return;
  const people = readStore().sessions.filter((p) => !p.deleting);
  const card = people.find((p) => p.id === employeeId);
  if (!card || card.managementRole === 'secretary') return;
  const state = readAccessState();
  const resourceId = `host:${hostId}`;
  state.grants = [
    ...state.grants.filter((g) => !(g.employeeId === employeeId && g.resourceId === resourceId)),
    { employeeId, resourceId, read: true, write: true, create: true },
  ];
  state.revision++;
  atomicJson(accessFile(), state, true);
  emitCoreEvent({ channel: 'access:changed', payload: { target: 'host', resourceId } });
}

export function hostResources(principal: PrincipalRef = requestContext().principal) {
  const resources = allHostResourceItems();
  const state = readAccessState();
  if (isAppAdministrator(principal)) {
    return {
      revision: state.revision,
      resources: resources.map((resource) => ({
        ...resource,
        rights: {
          read: (resource.capabilities ?? ['read', 'write', 'create']).includes('read'),
          write: (resource.capabilities ?? ['read', 'write', 'create']).includes('write'),
          create: (resource.capabilities ?? ['read', 'write', 'create']).includes('create'),
        },
      })),
    };
  }
  if (principal.kind !== 'agent') return { revision: state.revision, resources: [] };
  const employeeId = principal.employeeId;
  const employeeGrants = state.grants.filter((g) => g.employeeId === employeeId);
  const store = readStore();
  const card = store.sessions.find((p) => p.id === employeeId);
  const boundHostId = card ? employeeSettings(store, card).hostId : undefined;
  if (!employeeGrants.some((g) => g.read || g.write || g.create) && !boundHostId) {
    return { revision: state.revision, resources: [] };
  }
  const scope = { employeeId, grants: employeeGrants };
  const granted = resources.flatMap((resource) => {
    const explicit = pluginResourceRights(scope, resources, resource.id);
    const isBound = boundHostId && resource.id === `host:${boundHostId}`;
    const rights =
      explicit.read || explicit.write || explicit.create
        ? explicit
        : isBound
          ? { read: true, write: false, create: false }
          : { read: false, write: false, create: false };
    return rights.read || rights.write || rights.create ? [{ ...resource, rights }] : [];
  });
  return { revision: state.revision, resources: granted };
}

export function hostAccess(args: {
  resourceIds?: string[];
  updates?: PluginGrant[];
  employees?: { employeeId: string; read: boolean; write: boolean; create: boolean }[];
  expectedRevision?: number;
}) {
  requireAppAdministrator();
  const resources = allHostResourceItems();
  const state = readAccessState();
  const people = readStore().sessions.filter((p) => !p.deleting);

  if (args.employees !== undefined || args.updates !== undefined) {
    if (args.expectedRevision !== state.revision) {
      throw Error('Host access changed; reload before saving');
    }
    const resourceIds = args.updates ? [...new Set(args.updates.map((g) => g.resourceId))] : args.resourceIds;
    const employees = args.updates ?? args.employees;
    if (
      !Array.isArray(resourceIds) ||
      !resourceIds.length ||
      resourceIds.length > 1000 ||
      resourceIds.some((id) => !resources.some((r) => r.id === id))
    ) {
      throw Error('Choose existing cloud host resources');
    }
    if (
      !Array.isArray(employees) ||
      employees.length > 200000 ||
      employees.some(
        (g) =>
          !people.some((p) => p.id === g.employeeId) ||
          (['read', 'write', 'create'] as const).some((right) => typeof g[right] !== 'boolean'),
      )
    ) {
      throw Error('Choose existing employees and explicit read/write/create rights');
    }

    const selected = new Set(resourceIds);
    const grants = state.grants.filter((g) =>
      args.updates
        ? !args.updates.some((u) => u.resourceId === g.resourceId && u.employeeId === g.employeeId)
        : !(selected.has(g.resourceId) && (!employees.length || employees.some((employee) => employee.employeeId === g.employeeId))),
    );
    for (const resourceId of selected) {
      for (const employee of employees.filter((g) => !args.updates || (g as PluginGrant).resourceId === resourceId)) {
        if (people.find((p) => p.id === employee.employeeId)!.managementRole === 'secretary') continue;
        const capabilities = resources.find((r) => r.id === resourceId)!.capabilities ?? ['read', 'write', 'create'];
        if ((employee.write && !capabilities.includes('write')) || (employee.create && !capabilities.includes('create'))) {
          throw Error('This host resource does not support the selected permission');
        }
        const rights = {
          read: capabilities.includes('read') && (employee.read || employee.write || employee.create),
          write: employee.write,
          create: employee.create,
        };
        grants.push({ employeeId: employee.employeeId, resourceId, ...rights });
      }
    }
    state.grants = grants;
    state.revision++;
    atomicJson(accessFile(), state, true);
    emitCoreEvent({ channel: 'access:changed', payload: { target: 'host' } });
  }

  return {
    ...state,
    grants: state.grants.filter((g) => !args.resourceIds || args.resourceIds.includes(g.resourceId)),
    employees: people.map((p) => ({
      id: p.id,
      title: p.title,
      team: p.group ?? '',
      role: p.managementRole ?? 'employee',
    })),
    automaticRoles: ['secretary'],
  };
}
