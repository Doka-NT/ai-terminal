// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addSecretFindingsToContext,
  containsSecretPlaceholder,
  createContextFromTexts,
  createSecretMaskContext,
  createStreamingPlaceholderRedactor,
  createStreamingUnmasker,
  diffSecretMaskContext,
  displaySecretPlaceholders,
  findBareHighEntropySecrets,
  findCustomPatternSecrets,
  findSupplementalStrictSecrets,
  maskChatStreamRequest,
  maskTextForDisplay,
  maskText,
  parseGitleaksReport,
  resolveSecretPlaceholders,
  sanitizeSavedChatForStorage,
  unmaskText
} from '@main/utils/secretMasking'

afterEach(() => {
  vi.doUnmock('node:fs/promises')
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('secret masking utilities', () => {
  it('parses gitleaks JSON findings', () => {
    const findings = parseGitleaksReport(JSON.stringify([
      {
        RuleID: 'github-pat',
        Description: 'GitHub Personal Access Token',
        Secret: 'ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD',
        Match: 'GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD'
      }
    ]))

    expect(findings).toEqual([
      {
        ruleId: 'github-pat',
        description: 'GitHub Personal Access Token',
        secret: 'ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD',
        match: 'GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD'
      }
    ])
  })

  it('deduplicates secrets and restores masked text', () => {
    const context = createSecretMaskContext()
    addSecretFindingsToContext(context, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' },
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])

    const input = [
      'OPENAI_API_KEY=sk-live-ABCdef1234567890_ABCdef1234567890',
      'again sk-live-ABCdef1234567890_ABCdef1234567890'
    ].join('\n')
    const masked = maskText(input, context)

    expect(context.bindings).toHaveLength(1)
    expect(masked).not.toContain('sk-live-ABCdef1234567890_ABCdef1234567890')
    expect(masked).toContain('[[TAVIRAQ_SECRET_1_GENERIC_API_KEY]]')
    expect(unmaskText(masked, context)).toBe(input)
  })

  it('ignores malformed empty bindings when masking text defensively', () => {
    const context = createSecretMaskContext()
    context.bindings.push({
      placeholder: '[[TAVIRAQ_SECRET_1_EMPTY]]',
      value: '',
      kind: 'empty'
    })

    expect(maskText('abc', context)).toBe('abc')
  })

  it('replaces longer overlapping secrets first', () => {
    const context = createSecretMaskContext()
    addSecretFindingsToContext(context, [
      { ruleId: 'short-token', secret: 'abc12345' },
      { ruleId: 'long-token', secret: 'abc12345-SECRET-67890' }
    ])

    expect(maskText('value=abc12345-SECRET-67890', context)).toBe('value=[[TAVIRAQ_SECRET_2_LONG_TOKEN]]')
  })

  it('finds contextual high-entropy values without flagging git SHAs', () => {
    const findings = findSupplementalStrictSecrets([
      'DEPLOY_TOKEN=AbCdEf1234567890_AbCdEf1234567890',
      'COMMIT=2df91d10f0802b5eb69f93333bf3b64b98003113'
    ].join('\n'))

    expect(findings.map((finding) => finding.secret)).toEqual(['AbCdEf1234567890_AbCdEf1234567890'])
  })

  it('finds a bare Google OAuth authorization code with no surrounding keyword', () => {
    const code = '4/0AVGzR9k1pXY7cLmN3wQaT5oZbEuHsFj2dRkPq8xnLiC4tM'
    const findings = findSupplementalStrictSecrets(`pasted by accident: ${code}`)

    expect(findings).toEqual([{
      ruleId: 'taviraq-google-oauth-code',
      description: 'Google OAuth authorization code',
      secret: code,
      match: code
    }])
  })

  it('finds a bare Google OAuth refresh token with no surrounding keyword', () => {
    const token = '1//0gWq3Zt8mYcLd5RxNjVb2FsHk7uPaT9oXi4nQyG1cMrE6zW'
    const findings = findSupplementalStrictSecrets(`pasted by accident: ${token}`)

    expect(findings).toEqual([{
      ruleId: 'taviraq-google-oauth-refresh-token',
      description: 'Google OAuth refresh token',
      secret: token,
      match: token
    }])
  })

  it('does not flag an ordinary path segment as a Google OAuth code or refresh token', () => {
    const authText = 'see docs/4/migration-guide-for-authorization for details'
    const refreshText = 'see docs/1//migration-guide-for-authorization for details'

    expect(findSupplementalStrictSecrets(authText)).toHaveLength(0)
    expect(findSupplementalStrictSecrets(refreshText)).toHaveLength(0)
  })

  it('does not flag a versioned or capitalized path segment either', () => {
    // A digit (version number) or one capitalized word is not, on its own, proof a
    // slug is actually a random secret body -- this is what tripped up an earlier,
    // simpler version of this guard that only checked for digit/uppercase presence.
    const versionedSlug = 'see docs/4/migration-guide-v2-authorization for details'
    const capitalizedSlug = 'see docs/1//OAuth-migration-guide-for-enterprise-teams for details'

    expect(findSupplementalStrictSecrets(versionedSlug)).toHaveLength(0)
    expect(findSupplementalStrictSecrets(capitalizedSlug)).toHaveLength(0)
  })

  it('finds a bare high-entropy token with no keyword or provider prefix', () => {
    const token = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'
    const findings = findBareHighEntropySecrets(`pasted by accident: ${token}`)

    expect(findings).toEqual([{
      ruleId: 'taviraq-bare-high-entropy',
      description: 'Taviraq bare high-entropy value',
      secret: token,
      match: token
    }])
  })

  it('does not flag benign high-entropy-looking values as bare secrets', () => {
    const gitSha = '2df91d10f0802b5eb69f93333bf3b64b98003113'
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    // Contains a digit on purpose: a naive \b-based tokenizer drops the leading "/"
    // from an absolute path (since \b is defined relative to \w, not this charset),
    // which would defeat isLikelyFilesystemPath() and, with a digit present, get
    // misread as high entropy. This is a regression test for that exact failure mode.
    const pathWithDigit = '/Users/artem/Projects/site-v2/dist/bundle-2024-final.js'
    const npmIntegrity = 'sha512-CoI4x1F1Ug7l8xVEkGdT7GcQlORISlqOGCLc0/wLo4LcYbaEV9dLtOwsAxpqGKfPBhpZH1lgloxNIfeDo8gkAg=='

    expect(findBareHighEntropySecrets(gitSha)).toHaveLength(0)
    expect(findBareHighEntropySecrets(uuid)).toHaveLength(0)
    expect(findBareHighEntropySecrets(pathWithDigit)).toHaveLength(0)
    expect(findBareHighEntropySecrets(npmIntegrity)).toHaveLength(0)
  })

  it('caps bare-entropy findings to avoid unbounded scans', () => {
    const tokens = Array.from({ length: 60 }, (_, i) => `Tok3n_${i}_aB3xQ9kL7mZpR2vT8nW1cY4dF6gH5j`)
    const findings = findBareHighEntropySecrets(tokens.join(' '))

    expect(findings.length).toBeLessThanOrEqual(40)
  })

  it('does not let repeated duplicate values exhaust the cap before a later distinct secret', () => {
    const repeated = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'
    const laterDistinctSecret = 'zZ9yQ8-jK6nM_oP1wS7vU3bX5eG4fH2i'
    const text = [...Array.from({ length: 50 }, () => repeated), laterDistinctSecret].join(' ')

    const values = findBareHighEntropySecrets(text).map((finding) => finding.secret)

    expect(values.filter((value) => value === repeated)).toHaveLength(1)
    expect(values).toContain(laterDistinctSecret)
  })

  it('does not flag relative paths or versioned filenames as bare secrets', () => {
    const relativePath = 'dist/bundle-2024-final.js'
    const archiveFilename = 'node-v20.10.0-darwin-arm64.tar.gz'
    const extensionlessRoute = 'docs/4/migration-guide-v2-authorization'

    expect(findBareHighEntropySecrets(relativePath)).toHaveLength(0)
    expect(findBareHighEntropySecrets(archiveFilename)).toHaveLength(0)
    expect(findBareHighEntropySecrets(extensionlessRoute)).toHaveLength(0)
  })

  it('still finds a genuinely random slash-bearing bare secret', () => {
    const token = 'aB3xQ9/kL7mZ_pR2/vT8nW1cY4dF6gH5j'

    expect(findBareHighEntropySecrets(token).map((finding) => finding.secret)).toEqual([token])
  })

  it('does not flag extensionless versioned platform/artifact names as bare secrets', () => {
    const nodeArtifact = 'node-v20.10.0-darwin-arm64'
    const platformTriple = 'x86_64-apple-darwin23.4.0'

    expect(findBareHighEntropySecrets(nodeArtifact)).toHaveLength(0)
    expect(findBareHighEntropySecrets(platformTriple)).toHaveLength(0)
  })

  it('finds a bare password using typical special-character complexity rules', () => {
    const password = 'XyZ9!aBcD3#eFgH4$jKlM5%nOpQ6'

    expect(findBareHighEntropySecrets(password)).toEqual([{
      ruleId: 'taviraq-bare-high-entropy',
      description: 'Taviraq bare high-entropy value',
      secret: password,
      match: password
    }])
  })

  it('does not flag common certificate/key filenames as bare secrets', () => {
    const pemFile = 'service-account-production-2024.pem'
    const keyFile = 'server-private-2024-01.key'
    const crtFile = 'wildcard-example-2024.crt'

    expect(findBareHighEntropySecrets(pemFile)).toHaveLength(0)
    expect(findBareHighEntropySecrets(keyFile)).toHaveLength(0)
    expect(findBareHighEntropySecrets(crtFile)).toHaveLength(0)
  })

  it('does not flag a public SSH host-key fingerprint as a bare secret', () => {
    const line = 'ED25519 key fingerprint is SHA256:qP8xN2vK9mZ7cL4wR6tY1bF3jH5sD0aG8eU2xC9k'

    expect(findBareHighEntropySecrets(line)).toHaveLength(0)
  })

  it('binds only the trimmed form when a bare secret is followed by sentence-ending punctuation', () => {
    // "." (and "?") are essentially never a deliberate final character of a real secret,
    // so the far more common "secret sitting in a sentence" case should resolve to the
    // secret alone, not the secret plus the sentence's trailing period.
    const token = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'
    const sentence = `use ${token}.`

    const findings = findBareHighEntropySecrets(sentence)

    expect(findings).toEqual([{
      ruleId: 'taviraq-bare-high-entropy',
      description: 'Taviraq bare high-entropy value',
      secret: token,
      match: token
    }])
  })

  it('registers both the trimmed and untrimmed forms only for trailing "!"', () => {
    // Unlike "." / "?", "!" is a standard password-complexity special character and
    // plausibly IS the real last character of a secret, so both forms are kept -- see
    // the maskChatStreamRequest test below for the actual no-leak assertion.
    const token = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'
    const sentence = `use ${token}!`

    const findings = findBareHighEntropySecrets(sentence)

    expect(findings.map((finding) => finding.secret)).toEqual(
      expect.arrayContaining([token, `${token}!`])
    )
    expect(findings).toHaveLength(2)
  })

  it('fully masks a secret that genuinely ends in kept punctuation, with no trailing leak', async () => {
    const realPassword = 'XyZ9!aBcD3#eFgH4$jKlM5%nOpQ6!'

    const { request } = await maskChatStreamRequest({
      requestId: 'req-1',
      provider: { name: 'test-provider', baseUrl: 'https://example.test', apiKeyRef: 'test-key' },
      messages: [{ role: 'user', content: 'what does this mean?' }],
      context: {
        selectedText: '',
        terminalOutput: `generated password: ${realPassword}`
      }
    }, 'on')

    expect(request.context.terminalOutput).not.toContain(realPassword)
    // Not even the trailing "!" should survive unmasked next to the placeholder.
    expect(request.context.terminalOutput).not.toMatch(/\]\]!/)
  })

  it('does not flag a public DNS hostname (including one with a random-looking resource-id label) as a bare secret', () => {
    const internalHostname = 'ip-10-0-1-23.us-west-2.compute.internal'
    const rdsEndpoint = 'mydb-instance.c9akciq32.us-east-1.rds.amazonaws.com'

    expect(findBareHighEntropySecrets(internalHostname)).toHaveLength(0)
    expect(findBareHighEntropySecrets(rdsEndpoint)).toHaveLength(0)
  })

  it('does not flag an extensionless relative route containing a double slash', () => {
    const route = 'docs/1//migration-guide-for-authorization'

    expect(findBareHighEntropySecrets(route)).toHaveLength(0)
  })

  it('finds a bare lowercase password built only from digits and kept password symbols', () => {
    const password = 'n8q4!m2z#p7x$w5v%r9t6y1u'

    expect(findBareHighEntropySecrets(password)).toEqual([{
      ruleId: 'taviraq-bare-high-entropy',
      description: 'Taviraq bare high-entropy value',
      secret: password,
      match: password
    }])
  })

  it('does not flag a slash-free documentation slug as a bare secret', () => {
    const slug = 'migration-guide-v2-authorization'

    expect(findBareHighEntropySecrets(slug)).toHaveLength(0)
  })

  it('does not flag a Kubernetes-generated pod/resource name as a bare secret', () => {
    const podName = 'frontend-api-7d9f4c6b5d-x8k2m'

    expect(findBareHighEntropySecrets(podName)).toHaveLength(0)
  })

  it('does not treat an existing secret placeholder body as a new bare secret', () => {
    const text = 'previous answer used [[TAVIRAQ_SECRET_1_GENERIC_API_KEY]] already'

    expect(findBareHighEntropySecrets(text)).toHaveLength(0)
  })

  it('does not corrupt a round-tripped placeholder from a previous turn', async () => {
    const existing = createSecretMaskContext()
    addSecretFindingsToContext(existing, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])
    const placeholder = existing.bindings[0].placeholder
    const roundTrippedText = `previous turn already referenced ${placeholder}`

    const next = await createContextFromTexts([roundTrippedText], 'on', undefined, existing)

    expect(next.bindings).toHaveLength(1)
    expect(maskText(roundTrippedText, next)).toBe(roundTrippedText)
  })

  it('finds custom regex secrets using the first capture group', () => {
    const settings = {
      mode: 'on' as const,
      applyToChatDisplay: true,
      applyToProviderPayloads: true,
      strictTerminalContext: false,
      customPatterns: [{
        id: 'internal',
        name: 'Internal token',
        pattern: 'INTERNAL_TOKEN=([A-Z0-9-]{12,})',
        enabled: true,
        createdAt: '2026-05-17T00:00:00.000Z'
      }]
    }

    const findings = findCustomPatternSecrets('INTERNAL_TOKEN=ABCDEF-123456-ZYXW', settings)

    expect(findings).toEqual([{
      ruleId: 'custom-INTERNAL_TOKEN',
      description: 'Custom pattern: Internal token',
      secret: 'ABCDEF-123456-ZYXW',
      match: 'INTERNAL_TOKEN=ABCDEF-123456-ZYXW'
    }])
  })

  it('applies custom regexes while masking display text', async () => {
    const result = await maskTextForDisplay('INTERNAL_TOKEN=ABCDEF-123456-ZYXW', {
      mode: 'on' as const,
      applyToChatDisplay: true,
      applyToProviderPayloads: true,
      strictTerminalContext: false,
      customPatterns: [{
        id: 'internal',
        name: 'Internal token',
        pattern: 'INTERNAL_TOKEN=([A-Z0-9-]{12,})',
        enabled: true,
        createdAt: '2026-05-17T00:00:00.000Z'
      }]
    })

    expect(result.text).toBe('INTERNAL_TOKEN=[secret]')
    expect(result.context.bindings[0]?.kind).toBe('CUSTOM_INTERNAL_TOKEN')
  })

  it('skips unsafe custom regex patterns', () => {
    const makeSettings = (pattern: string) => ({
      mode: 'on' as const,
      applyToChatDisplay: true,
      applyToProviderPayloads: true,
      strictTerminalContext: false,
      customPatterns: [{
        id: 'bad',
        name: 'Bad pattern',
        pattern,
        enabled: true,
        createdAt: '2026-05-17T00:00:00.000Z'
      }]
    })

    expect(findCustomPatternSecrets('aaaaaaaaaaaaaaaaaaaaaaaa!', makeSettings('(a+)+$'))).toHaveLength(0)
    expect(findCustomPatternSecrets('aaaaaaaaaaaaaaaaaaaaaaaa!', makeSettings('(a|a)+$'))).toHaveLength(0)
    expect(findCustomPatternSecrets('aaaaaaaaaaaaaaaaaaaaaaaa!', makeSettings('((a+))+$'))).toHaveLength(0)
    expect(findCustomPatternSecrets('aaaaaaaaaaaaaaaaaaaaaaaa!', makeSettings('(a+)\\1'))).toHaveLength(0)
    expect(findCustomPatternSecrets('aaaaaaaaaaaaaaaaaaaaaaaa!', makeSettings('(?=a+)a+'))).toHaveLength(0)
  })

  it('does not flag long filesystem paths as contextual secrets', () => {
    const findings = findSupplementalStrictSecrets([
      'TOKEN_PATH=/Users/artem/AbCdEf1234567890_AbCdEf1234567890',
      'PASSWORD_FILE=~/secrets/AbCdEf1234567890_AbCdEf1234567890',
      'API_KEY=C:\\Users\\artem\\AbCdEf1234567890_AbCdEf1234567890',
      'SECRET=\\\\server\\share\\AbCdEf1234567890_AbCdEf1234567890'
    ].join('\n'))

    expect(findings).toHaveLength(0)
  })

  it('falls back to contextual checks when gitleaks is unavailable', async () => {
    vi.doMock('node:fs/promises', () => ({
      access: vi.fn().mockRejectedValue(new Error('missing gitleaks'))
    }))
    vi.resetModules()

    const { scanTextForSecrets } = await import('@main/utils/secretMasking')
    const findings = await scanTextForSecrets('DEPLOY_TOKEN=AbCdEf1234567890_AbCdEf1234567890', 'on')

    expect(findings.map((finding) => finding.secret)).toContain('AbCdEf1234567890_AbCdEf1234567890')
  })

  it('fails closed when an available gitleaks scanner returns unreadable output', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'taviraq-gitleaks-bad-output-'))
    const fakeGitleaks = join(tempDir, 'gitleaks')
    await writeFile(fakeGitleaks, [
      '#!/bin/sh',
      'cat >/dev/null',
      'printf "%s" "not-json"'
    ].join('\n'), 'utf8')
    await chmod(fakeGitleaks, 0o755)
    vi.stubEnv('TAVIRAQ_GITLEAKS_PATH', fakeGitleaks)
    vi.resetModules()

    try {
      const { scanTextForSecrets } = await import('@main/utils/secretMasking')
      await expect(scanTextForSecrets('DEPLOY_TOKEN=AbCdEf1234567890_AbCdEf1234567890', 'on'))
        .rejects.toThrow('unreadable report')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('skips scanner work when masking mode is off', async () => {
    const context = await createContextFromTexts([
      'OPENAI_API_KEY=sk-live-ABCdef1234567890_ABCdef1234567890'
    ], 'off')

    expect(context.bindings).toHaveLength(0)
  })

  it('unmasks placeholders split across stream chunks', () => {
    const context = createSecretMaskContext()
    addSecretFindingsToContext(context, [
      { ruleId: 'generic-token', secret: 'secret-value-ABC123_secret-value-ABC123' }
    ])
    const unmasker = createStreamingUnmasker(context)
    const chunks = [
      unmasker.push('token [[TAVIRAQ_SEC'),
      unmasker.push('RET_1_GENERIC_TOKEN]] ok'),
      unmasker.flush()
    ]

    expect(chunks.join('')).toBe('token secret-value-ABC123_secret-value-ABC123 ok')
  })

  it('redacts placeholders split across stream chunks', () => {
    const redactor = createStreamingPlaceholderRedactor()
    const chunks = [
      redactor.push('token [[TAVIRAQ_SEC'),
      redactor.push('RET_1_GENERIC_TOKEN]] ok'),
      redactor.flush()
    ]

    expect(chunks.join('')).toBe('token [secret] ok')
  })

  it('resolves placeholders for confirmed local execution', () => {
    const context = createSecretMaskContext()
    addSecretFindingsToContext(context, [
      { ruleId: 'bearer-token', secret: 'token-ABC1234567890_token-ABC1234567890' }
    ])
    const command = 'curl -H "Authorization: Bearer [[TAVIRAQ_SECRET_1_BEARER_TOKEN]]" https://example.test'

    expect(containsSecretPlaceholder(command)).toBe(true)
    expect(resolveSecretPlaceholders(command, context)).toContain('token-ABC1234567890_token-ABC1234567890')
  })

  it('extends an existing context without reusing old placeholder ids', async () => {
    const existing = createSecretMaskContext()
    addSecretFindingsToContext(existing, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])

    const next = await createContextFromTexts([
      'DEPLOY_TOKEN=DeployABC1234567890_DeployABC1234567890'
    ], 'on', undefined, existing)

    expect(next.bindings.map((binding) => binding.placeholder)).toEqual([
      '[[TAVIRAQ_SECRET_1_GENERIC_API_KEY]]',
      '[[TAVIRAQ_SECRET_2_DEPLOY_TOKEN]]'
    ])
    expect(resolveSecretPlaceholders('[[TAVIRAQ_SECRET_1_GENERIC_API_KEY]]', next))
      .toBe('sk-live-ABCdef1234567890_ABCdef1234567890')
    expect(resolveSecretPlaceholders('[[TAVIRAQ_SECRET_2_DEPLOY_TOKEN]]', next))
      .toBe('DeployABC1234567890_DeployABC1234567890')
  })

  it('diffs secret contexts so audit events only count new findings', async () => {
    const existing = createSecretMaskContext()
    addSecretFindingsToContext(existing, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])

    const next = await createContextFromTexts([
      'OPENAI_API_KEY=sk-live-ABCdef1234567890_ABCdef1234567890',
      'DEPLOY_TOKEN=DeployABC1234567890_DeployABC1234567890'
    ], 'on', undefined, existing)
    const diff = diffSecretMaskContext(next, existing)

    expect(diff.bindings.map((binding) => binding.kind)).toEqual(['DEPLOY_TOKEN'])
    expect(diff.byValue.has('DeployABC1234567890_DeployABC1234567890')).toBe(true)
    expect(diff.byValue.has('sk-live-ABCdef1234567890_ABCdef1234567890')).toBe(false)
  })

  it('masks real secret values in command output for display', () => {
    const context = createSecretMaskContext()
    addSecretFindingsToContext(context, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])

    const output = displaySecretPlaceholders(maskText(
      'token sk-live-ABCdef1234567890_ABCdef1234567890',
      context
    ))

    expect(output).toBe('token [secret]')
  })

  it('scans command output for new secrets before displaying it', async () => {
    const existing = createSecretMaskContext()
    addSecretFindingsToContext(existing, [
      { ruleId: 'generic-api-key', secret: 'sk-live-ABCdef1234567890_ABCdef1234567890' }
    ])

    const result = await maskTextForDisplay([
      'OPENAI_API_KEY=sk-live-ABCdef1234567890_ABCdef1234567890',
      'DEPLOY_TOKEN=DeployABC1234567890_DeployABC1234567890'
    ].join('\n'), 'on', existing)

    expect(result.text).toBe([
      'OPENAI_API_KEY=[secret]',
      'DEPLOY_TOKEN=[secret]'
    ].join('\n'))
    expect(result.context.bindings.map((binding) => binding.placeholder)).toEqual([
      '[[TAVIRAQ_SECRET_1_GENERIC_API_KEY]]',
      '[[TAVIRAQ_SECRET_2_DEPLOY_TOKEN]]'
    ])
    expect(resolveSecretPlaceholders('[[TAVIRAQ_SECRET_2_DEPLOY_TOKEN]]', result.context))
      .toBe('DeployABC1234567890_DeployABC1234567890')
  })

  it('redacts raw scanned secrets before saving chat history', async () => {
    const secret = 'sk-live-ABCdef1234567890_ABCdef1234567890'
    const sanitized = await sanitizeSavedChatForStorage({
      id: 'chat-1',
      title: `OPENAI_API_KEY=${secret}`,
      messages: [
        {
          role: 'user',
          content: `OPENAI_API_KEY=${secret}`
        },
        {
          role: 'assistant',
          content: 'done',
          output: `token ${secret}`,
          reasoningContent: `saw ${secret}`
        }
      ],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z'
    }, 'on')

    expect(JSON.stringify(sanitized)).not.toContain(secret)
    expect(sanitized.title).toBe('OPENAI_API_KEY=[secret]')
    expect(sanitized.messages[0].content).toBe('OPENAI_API_KEY=[secret]')
    expect(sanitized.messages[1].output).toBe('token [secret]')
    expect(sanitized.messages[1].reasoningContent).toBe('saw [secret]')
  })

  it('masks a bare-pasted terminal secret in the outgoing provider request (issue #211)', async () => {
    const bareToken = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'
    const oauthCode = '4/0AVGzR9k1pXY7cLmN3wQaT5oZbEuHsFj2dRkPq8xnLiC4tM'

    const { request, context } = await maskChatStreamRequest({
      requestId: 'req-1',
      provider: { name: 'test-provider', baseUrl: 'https://example.test', apiKeyRef: 'test-key' },
      messages: [{ role: 'user', content: 'what does this terminal output mean?' }],
      context: {
        selectedText: '',
        terminalOutput: [
          `$ echo pasted a token by accident: ${bareToken}`,
          `$ echo also pasted an oauth code: ${oauthCode}`
        ].join('\n')
      }
    }, 'on')

    expect(request.context.terminalOutput).not.toContain(bareToken)
    expect(request.context.terminalOutput).not.toContain(oauthCode)
    expect(context.bindings.map((binding) => binding.kind)).toEqual(
      expect.arrayContaining(['BARE_HIGH_ENTROPY', 'GOOGLE_OAUTH_CODE'])
    )
  })

  it('preserves an extensionless relative route while masking a neighboring bare secret', async () => {
    const route = 'docs/4/migration-guide-v2-authorization'
    const bareToken = 'aB3xQ9-kL7mZ_pR2vT8nW1cY4dF6gH5j'

    const { request } = await maskChatStreamRequest({
      requestId: 'req-1',
      provider: { name: 'test-provider', baseUrl: 'https://example.test', apiKeyRef: 'test-key' },
      messages: [{ role: 'user', content: 'what does this terminal output mean?' }],
      context: {
        selectedText: '',
        terminalOutput: `open ${route} with token ${bareToken}`
      }
    }, 'on')

    expect(request.context.terminalOutput).toContain(route)
    expect(request.context.terminalOutput).not.toContain(bareToken)
  })
})
