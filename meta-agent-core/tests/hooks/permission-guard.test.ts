// tests/hooks/permission-guard.test.ts

import { createPermissionHooks } from '../../src/hooks/permission-guard';
import { createInitialState } from '../../src/runtime/state';

describe('PermissionGuard', () => {
  test('proposal 含 curl 时 Level 2 返回 block', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 2); // Level 2
    
    const result = await hooks.onBeforeExec!(state, 'curl http://example.com');
    
    expect(result).toBe('block');
  });

  test('proposal 含 curl 时 Level 3 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 3); // Level 3
    
    const result = await hooks.onBeforeExec!(state, 'curl http://example.com');
    
    expect(result).toBe('proceed');
  });

  test('proposal 含 rm -rf 时 Level 2 返回 block', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 2);
    
    const result = await hooks.onBeforeExec!(state, 'rm -rf /tmp');
    
    expect(result).toBe('block');
  });

  test('proposal 含 rm -rf 时 Level 3 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 3);
    
    const result = await hooks.onBeforeExec!(state, 'rm -rf /tmp');
    
    expect(result).toBe('proceed');
  });

  test('proposal 含 write( 时 Level 1 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 1);
    
    const result = await hooks.onBeforeExec!(state, 'write(file, content)');
    
    expect(result).toBe('proceed');
  });

  test('proposal 含 write( 时 Level 0 返回 block', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 0);
    
    const result = await hooks.onBeforeExec!(state, 'write(file, content)');
    
    expect(result).toBe('block');
  });

  test('proposal 含 bash( 时 Level 2 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 2);
    
    const result = await hooks.onBeforeExec!(state, 'bash("ls")');
    
    expect(result).toBe('proceed');
  });

  test('proposal 含 bash( 时 Level 1 返回 block', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 1);
    
    const result = await hooks.onBeforeExec!(state, 'bash("ls")');
    
    expect(result).toBe('block');
  });

  test('其他操作 Level 0 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 0);
    
    const result = await hooks.onBeforeExec!(state, 'read(file)');
    
    expect(result).toBe('proceed');
  });

  test('proposal 含 wget 时 Level 2 返回 block', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 2);
    
    const result = await hooks.onBeforeExec!(state, 'wget http://example.com');
    
    expect(result).toBe('block');
  });

  test('proposal 含 wget 时 Level 3 返回 proceed', async () => {
    const hooks = createPermissionHooks();
    const state = createInitialState('test', 3);
    
    const result = await hooks.onBeforeExec!(state, 'wget http://example.com');
    
    expect(result).toBe('proceed');
  });
});
