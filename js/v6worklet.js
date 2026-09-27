// AudioWorklet del motor: el generador está en engineDSP.js (el mismo que usa tools/engineWav.mjs en node)
import { makeV6 } from './engineDSP.js';
class V6 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 5000, minValue: 1000, maxValue: 16000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.p = makeV6(sampleRate, 7); }
  process(inputs, outputs, P) {
    const o = outputs[0][0]; if (!o) return true;
    this.p(o, o.length, P.rpm[0], P.load[0], P.cut[0]);
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(o);
    return true;
  }
}
registerProcessor('v6', V6);
