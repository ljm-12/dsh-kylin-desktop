import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedFiles, assertAllowedChanges, verifyOfficialSource } from '../scripts/verify-official-source.mjs'

test('official baseline gate permits platform files and rejects product changes', () => {
  assertAllowedChanges([...allowedFiles])
  for (const file of [
    'apps/desktop/src/web-document.ts',
    'packages/client/connection/src/client/connection.ts',
    'packages/api/gateway/src/client/stream-client.ts',
    'packages/util/http-proxy/src/policy.ts',
    'apps/web/src/new-feature.ts',
  ]) assert.throws(() => assertAllowedChanges([file]), /runtime\/UI outside the Linux shell adapters must remain unchanged/)
})
test('checkout is the pinned official runtime', { skip: !process.env.DSH_TEST_SOURCE }, () => {
  verifyOfficialSource(process.env.DSH_TEST_SOURCE)
})
