import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceNumbers } from '../../assets/paperhub/contract.mjs';

test('Equivalent source notation does not invalidate a correct number', () => {
  assert.deepEqual(evidenceNumbers('0.017\\% of the backbone'), evidenceNumbers('占骨干的0.017%'));
  assert.deepEqual(evidenceNumbers('3,000 images'), evidenceNumbers('3000张图片'));
  assert.deepEqual(evidenceNumbers('$2.3\\times$ model state'), evidenceNumbers('模型状态量的2.3倍'));
});
test('Numeric checks preserve units and magnitudes', () => {
  assert.notDeepEqual(evidenceNumbers('0.017'), evidenceNumbers('0.017%'));
  assert.notDeepEqual(evidenceNumbers('26.9%'), evidenceNumbers('269%'));
  assert.notDeepEqual(evidenceNumbers('2.3倍'), evidenceNumbers('2.3%'));
  assert.notDeepEqual(evidenceNumbers('3,000'), evidenceNumbers('300'));
});
