const { execFileSync } = require('node:child_process')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  execFileSync('xattr', ['-cr', context.appOutDir], { stdio: 'inherit' })
  execFileSync('find', [context.appOutDir, '-name', '._*', '-delete'], { stdio: 'inherit' })
}
