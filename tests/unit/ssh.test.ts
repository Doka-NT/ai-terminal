import { buildSshCommand, parseSshCommandTarget } from '@main/utils/ssh'

describe('SSH command generation', () => {
  it('builds a system ssh invocation without opening a network connection', () => {
    expect(buildSshCommand({
      host: 'prod',
      user: 'deploy',
      port: 2222,
      identityFile: '~/.ssh/id_ed25519'
    })).toEqual({
      command: 'ssh',
      args: ['-p', '2222', '-i', '~/.ssh/id_ed25519', 'deploy@prod'],
      label: 'deploy@prod',
      remoteHost: 'prod',
      remoteTarget: 'deploy@prod'
    })
  })

  it('keeps a profile label while exposing the ssh target', () => {
    expect(buildSshCommand({
      name: 'Production',
      host: 'prod.example.com',
      user: 'deploy'
    })).toEqual({
      command: 'ssh',
      args: ['deploy@prod.example.com'],
      label: 'Production',
      remoteHost: 'prod.example.com',
      remoteTarget: 'deploy@prod.example.com'
    })
  })

  it('extracts the target from a typed ssh command', () => {
    expect(parseSshCommandTarget('ssh myhost.com')).toEqual({
      remoteHost: 'myhost.com',
      remoteTarget: 'myhost.com'
    })
    expect(parseSshCommandTarget('/usr/bin/ssh vpn.footech.ru')).toEqual({
      remoteHost: 'vpn.footech.ru',
      remoteTarget: 'vpn.footech.ru'
    })
    expect(parseSshCommandTarget('ssh deploy@myhost.com')).toEqual({
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com'
    })
  })

  it('skips ssh options before extracting the target', () => {
    expect(parseSshCommandTarget('ssh -p 2222 -i ~/.ssh/id_ed25519 -l deploy myhost.com')).toEqual({
      remoteHost: 'myhost.com',
      remoteTarget: 'deploy@myhost.com'
    })
  })
})
