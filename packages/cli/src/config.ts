import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_PATH: string = join(homedir(), '.config', 'hopstr', 'config.json')

interface Config {
  nsec?: string
  relays?: string[]
}

export async function readConfig(): Promise<Config> {
  try {
    const text = await Bun.file(CONFIG_PATH).text()
    return JSON.parse(text) as Config
  } catch {
    return {}
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const dir = join(homedir(), '.config', 'hopstr')
  await Bun.write(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
}

export { CONFIG_PATH }
