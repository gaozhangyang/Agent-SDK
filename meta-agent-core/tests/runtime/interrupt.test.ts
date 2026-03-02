// tests/runtime/interrupt.test.ts

import { InterruptChannel, InterruptSignal } from '../../src/runtime/interrupt';

describe('InterruptChannel', () => {
  let channel: InterruptChannel;

  beforeEach(() => {
    channel = new InterruptChannel();
  });

  test('poll() 空队列返回 null', () => {
    const result = channel.poll();
    expect(result).toBeNull();
  });

  test('push() 后 poll() 返回信号，再次 poll() 返回 null', () => {
    channel.push({ message: 'test', ts: 1000 });
    
    const result1 = channel.poll();
    expect(result1).not.toBeNull();
    expect(result1!.message).toBe('test');
    
    const result2 = channel.poll();
    expect(result2).toBeNull();
  });

  test('多次 push() 后按 FIFO 顺序 poll()', () => {
    channel.push({ message: 'first', ts: 1000 });
    channel.push({ message: 'second', ts: 2000 });
    channel.push({ message: 'third', ts: 3000 });
    
    const first = channel.poll();
    expect(first!.message).toBe('first');
    
    const second = channel.poll();
    expect(second!.message).toBe('second');
    
    const third = channel.poll();
    expect(third!.message).toBe('third');
    
    const empty = channel.poll();
    expect(empty).toBeNull();
  });

  test('isEmpty() 正确反映队列状态', () => {
    expect(channel.isEmpty()).toBe(true);
    
    channel.push({ message: 'test', ts: 1000 });
    expect(channel.isEmpty()).toBe(false);
    
    channel.poll();
    expect(channel.isEmpty()).toBe(true);
  });

  test('size() 返回队列长度', () => {
    expect(channel.size()).toBe(0);
    
    channel.push({ message: '1', ts: 1000 });
    channel.push({ message: '2', ts: 2000 });
    expect(channel.size()).toBe(2);
    
    channel.poll();
    expect(channel.size()).toBe(1);
  });

  test('push 多个信号后可以依次取出', () => {
    const signals: InterruptSignal[] = [
      { message: 'msg1', ts: 1 },
      { message: 'msg2', ts: 2 },
      { message: 'msg3', ts: 3 },
    ];
    
    for (const s of signals) {
      channel.push(s);
    }
    
    for (let i = 0; i < signals.length; i++) {
      const result = channel.poll();
      expect(result?.message).toBe(`msg${i + 1}`);
    }
  });
});
