// Synthetic native CLI profiles for isolated test environments.
// Writes only into the native directories named by the caller's isolated env;
// never falls back to, reads or writes the real user's configuration.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The only credential value test fixtures may use. */
export const FIXTURE_SECRET = 'fixture-only-not-real'

const realDefaults = {
  CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.claude'),
  CLINE_DATA_DIR: path.join(os.homedir(), '.cline', 'data'),
  PI_CODING_AGENT_DIR: path.join(os.homedir(), '.pi', 'agent'),
  CODEX_HOME: path.join(os.homedir(), '.codex')
}

function isolatedRoot(env, key) {
  const value = env[key]
  if (!value || !path.isAbsolute(value)) throw new Error(`native-profiles: ${key} must point at an isolated absolute directory`)
  const root = path.resolve(value)
  if (root === path.resolve(realDefaults[key])) throw new Error(`native-profiles: refusing to write the real ${key}`)
  return root
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
}

const claudeSettings = {
  model: 'deepseek-flash[1m]',
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: FIXTURE_SECRET,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash'
  },
  modelPicker: {
    replaceBuiltInOptions: true,
    options: [
      { model: 'deepseek-flash[1m]', label: 'DeepSeek Flash' },
      { model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
    ]
  }
}

const clineProviders = {
  version: 1,
  lastUsedProvider: 'deepseek',
  providers: {
    deepseek: {
      settings: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        baseUrl: 'https://api.deepseek.com',
        apiKey: FIXTURE_SECRET
      }
    }
  }
}

const clineModels = {
  providers: {
    deepseek: {
      models: {
        'deepseek-flash': { id: 'deepseek-flash', name: 'DeepSeek Flash' },
        'deepseek-v4-pro': { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
      }
    }
  }
}

const piSettings = { defaultProvider: 'deepseek', defaultModel: 'deepseek-flash' }

const piModels = {
  providers: {
    deepseek: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      apiKey: FIXTURE_SECRET,
      models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }]
    }
  }
}

const codexConfig = 'model = "codex-current"\nmodel_provider = "custom"\n[model_providers.custom]\nname = "Codex custom"\nbase_url = "https://codex.invalid/v1"\n'

const supported = ['claude', 'cline', 'codex', 'pi']

/**
 * Write synthetic native profiles into the isolated env's native directories.
 * Returns the synthetic secret and the absolute files written.
 */
export function writeNativeProfiles(env, { engines = supported } = {}) {
  for (const engine of engines) if (!supported.includes(engine)) throw new Error('native-profiles: unknown engine ' + engine)
  const files = []
  const roots = {}
  if (engines.includes('claude')) {
    const root = roots.claude = isolatedRoot(env, 'CLAUDE_CONFIG_DIR')
    const file = path.join(root, 'settings.json')
    write(file, claudeSettings)
    files.push(file)
  }
  if (engines.includes('cline')) {
    const root = roots.cline = isolatedRoot(env, 'CLINE_DATA_DIR')
    const providerFile = path.join(root, 'settings/providers.json')
    const modelFile = path.join(root, 'settings/models.json')
    write(providerFile, clineProviders)
    write(modelFile, clineModels)
    files.push(providerFile, modelFile)
  }
  if (engines.includes('pi')) {
    const root = roots.pi = isolatedRoot(env, 'PI_CODING_AGENT_DIR')
    const settingsFile = path.join(root, 'settings.json')
    const modelsFile = path.join(root, 'models.json')
    const authFile = path.join(root, 'auth.json')
    write(settingsFile, piSettings)
    write(modelsFile, piModels)
    write(authFile, {})
    files.push(settingsFile, modelsFile, authFile)
  }
  if (engines.includes('codex')) {
    const root = roots.codex = isolatedRoot(env, 'CODEX_HOME')
    const configFile = path.join(root, 'config.toml')
    const authFile = path.join(root, 'auth.json')
    write(configFile, codexConfig)
    write(authFile, { OPENAI_API_KEY: FIXTURE_SECRET })
    files.push(configFile, authFile)
  }
  return { secret: FIXTURE_SECRET, roots, files }
}
