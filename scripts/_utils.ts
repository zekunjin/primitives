import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { resolve } from 'pathe'
import { execaSync } from 'execa'
import { determineSemverChange, getGitDiff, loadChangelogConfig, parseCommits } from 'changelogen'

export interface Dep {
  name: string
  range: string
  type: string
}

type ThenArg<T> = T extends PromiseLike<infer U> ? U : T
export type Package = ThenArg<ReturnType<typeof loadPackage>>

export async function loadPackage(dir: string) {
  const pkgPath = resolve(dir, 'package.json')
  const data = JSON.parse(await fsp.readFile(pkgPath, 'utf-8').catch(() => '{}'))
  const save = () => fsp.writeFile(pkgPath, `${JSON.stringify(data, null, 2)}\n`)

  const updateDeps = (reviver: (dep: Dep) => Dep | void) => {
    for (const type of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (!data[type])
        continue
      for (const e of Object.entries(data[type])) {
        const dep: Dep = { name: e[0], range: e[1] as string, type }
        delete data[type][dep.name]
        const updated = reviver(dep) || dep
        data[updated.type] = data[updated.type] || {}
        data[updated.type][updated.name] = updated.range
      }
    }
  }

  return {
    dir,
    data,
    save,
    updateDeps,
  }
}

export async function loadWorkspace(dir: string) {
  const workspacePkg = await loadPackage(dir)

  const rename = (from: string, to: string) => {
    workspacePkg.data._name = workspacePkg.data.name
    workspacePkg.data.name = to
    workspacePkg.updateDeps((dep) => {
      if (dep.name === from && !dep.range.startsWith('npm:'))
        dep.range = `npm:${to}@${dep.range}`
    })
  }

  const setVersion = (newVersion: string, opts: { updateDeps?: boolean } = {}) => {
    workspacePkg.data.version = newVersion
  }

  const save = () => workspacePkg.save()

  return {
    dir,
    workspacePkg,
    save,
    rename,
    setVersion,
  }
}

export async function determineBumpType() {
  const config = await loadChangelogConfig(process.cwd())
  const commits = await getLatestCommits()

  const bumpType = determineSemverChange(commits, config)

  return bumpType === 'major' ? 'minor' : bumpType
}

export async function getLatestCommits() {
  const config = await loadChangelogConfig(process.cwd())
  const latestTag = execaSync('git', ['describe', '--tags', '--abbrev=0']).stdout

  return parseCommits(await getGitDiff(latestTag), config)
}
