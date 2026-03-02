// tests/hooks/error-classifier.test.ts

import { createErrorClassifier } from '../../src/hooks/error-classifier';

describe('ErrorClassifier', () => {
  test('ETIMEDOUT → retryable', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('ETIMEDOUT connection'));
    
    expect(result).toBe('retryable');
  });

  test('ECONNRESET → retryable', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('ECONNRESET'));
    
    expect(result).toBe('retryable');
  });

  test('lock → retryable', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('file is locked'));
    
    expect(result).toBe('retryable');
  });

  test('budget → budget', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('budget exceeded'));
    
    expect(result).toBe('budget');
  });

  test('rate limit → budget', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('rate limit exceeded'));
    
    expect(result).toBe('budget');
  });

  test('ENOENT → environment', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('ENOENT: no such file'));
    
    expect(result).toBe('environment');
  });

  test('permission denied → environment', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('permission denied'));
    
    expect(result).toBe('environment');
  });

  test('其他 → logic', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error('some random error'));
    
    expect(result).toBe('logic');
  });

  test('空错误 → logic', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!(new Error(''));
    
    expect(result).toBe('logic');
  });

  test('非 Error 对象 → logic', () => {
    const hooks = createErrorClassifier();
    
    const result = hooks.classifyError!('string error');
    
    expect(result).toBe('logic');
  });
});
