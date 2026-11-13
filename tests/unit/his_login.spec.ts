import { test } from '@japa/runner'
import { matchesPassweb } from '#services/his_login'

// md5('secret') = 5ebe2294ecd0e0f08eab7690d2a6ee69
test.group('his_login — matchesPassweb', () => {
  test('matches an upper-case MD5 (HOSxP style)', ({ assert }) => {
    assert.isTrue(matchesPassweb('secret', '5EBE2294ECD0E0F08EAB7690D2A6EE69'))
  })

  test('matches a lower-case MD5', ({ assert }) => {
    assert.isTrue(matchesPassweb('secret', '5ebe2294ecd0e0f08eab7690d2a6ee69'))
  })

  test('rejects a wrong password', ({ assert }) => {
    assert.isFalse(matchesPassweb('Secret', '5EBE2294ECD0E0F08EAB7690D2A6EE69'))
  })

  test('rejects an empty or malformed stored value', ({ assert }) => {
    assert.isFalse(matchesPassweb('', ''))
    assert.isFalse(matchesPassweb('secret', null))
    assert.isFalse(matchesPassweb('secret', 'secret'))
  })
})
