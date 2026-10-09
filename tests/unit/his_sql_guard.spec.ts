import { test } from '@japa/runner'
import { assertReadOnlySql, normalizeSql, UnsafeSqlError } from '#services/his_sql_guard'

test.group('his_sql_guard — assertReadOnlySql', () => {
  test('accepts plain SELECT / WITH / parenthesised SELECT: {$self}')
    .with([
      'SELECT COUNT(*) FROM ovst WHERE vstdate = CURDATE()',
      'select count(ov.hn) as cc from vn_stat ov ,patient pt where ov.hn=pt.hn',
      'SELECT COUNT(vn)\r\nFROM er_regist\r\nWHERE  vstdate=CURDATE()',
      'WITH t AS (SELECT 1 AS n) SELECT n FROM t',
      '(SELECT 1) UNION (SELECT 2)',
      'SELECT 1;',
      'SELECT 1 ;  \n',
      "SELECT * FROM t WHERE note = 'DELETE' OR note = 'update; drop table x'",
      'SELECT `update`, `delete` FROM t',
      'SELECT last_update, created_at, delete_flag FROM t',
      'SELECT CONVERT(name USING tis620) FROM t',
      '-- today count\nSELECT 1',
      'SELECT /*+ MAX_EXECUTION_TIME(1000) */ 1',
      "SELECT REPLACE(group_concat(icd10), ',', ' ') FROM ovstdiag",
      "SELECT INSERT(cid, 5, 4, 'XXXX') FROM patient",
    ])
    .run(({ assert }, sql) => {
      assert.doesNotThrow(() => assertReadOnlySql(sql))
    })

  test('rejects writes, multi-statements and side effects: {$self}')
    .with([
      'DELETE FROM ovst',
      'UPDATE ovst SET x = 1',
      'REPLACE INTO t VALUES (1)',
      'SELECT 1 FROM t WHERE x IN (SELECT 1); REPLACE t (a) VALUES (1)',
      'SELECT 1; DROP TABLE t',
      'SELECT * FROM t INTO OUTFILE "/tmp/x"',
      'SELECT * INTO @v FROM t',
      'SELECT LOAD_FILE("/etc/passwd")',
      'SELECT SLEEP(100)',
      'SELECT BENCHMARK(1e9, MD5(1))',
      'SELECT * FROM t FOR UPDATE',
      'SELECT * FROM t LOCK IN SHARE MODE',
      'WITH t AS (SELECT 1) DELETE FROM x',
      'CALL do_something()',
      'SET @a = 1',
      'SHOW TABLES',
      'SELECT 1 /*! ; DROP TABLE t */',
      '',
      '   ;  ',
    ])
    .run(({ assert }, sql) => {
      assert.throws(() => assertReadOnlySql(sql))
    })

  test('the error is an UnsafeSqlError with a Thai message', ({ assert }) => {
    try {
      assertReadOnlySql('SELECT * FROM t FOR UPDATE')
      assert.fail('should throw')
    } catch (e) {
      assert.instanceOf(e, UnsafeSqlError)
      assert.include((e as Error).message, 'UPDATE')
    }
  })

  test('normalizeSql trims whitespace and trailing semicolons', ({ assert }) => {
    assert.equal(normalizeSql('  SELECT 1 ;; \n'), 'SELECT 1')
    assert.equal(normalizeSql(null), '')
  })
})
