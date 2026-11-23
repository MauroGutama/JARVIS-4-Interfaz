import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStrategy, detectCapabilities, pickRecorderMime } from '../../web/js/speech-in.js';

const iphone = { native: true, recorder: true, secure: true, standalone: false };
const noSR = { native: false, recorder: true, secure: true, standalone: true };
const bare = { native: false, recorder: false, secure: true, standalone: false };

test('auto usa Safari nativo y cae al servidor si falla', () => {
  assert.equal(chooseStrategy('auto', iphone, { serverStt: true }), 'native');
  assert.equal(chooseStrategy('auto', iphone, { serverStt: true, nativeFailed: true }), 'server');
  assert.equal(chooseStrategy('auto', iphone, { serverStt: false, nativeFailed: true }), 'native');
  assert.equal(chooseStrategy('auto', noSR, { serverStt: true }), 'server');
  assert.equal(chooseStrategy('auto', noSR, { serverStt: false }), 'keyboard');
  assert.equal(chooseStrategy('auto', bare, { serverStt: true }), 'keyboard');
});

test('preferencias explícitas con alternativas', () => {
  assert.equal(chooseStrategy('keyboard', iphone, { serverStt: true }), 'keyboard');
  assert.equal(chooseStrategy('server', iphone, { serverStt: false }), 'native');
  assert.equal(chooseStrategy('native', noSR, { serverStt: true }), 'server');
  assert.equal(chooseStrategy('server', { ...iphone, secure: false }, { serverStt: true }), 'native');
});

test('detección de capacidades y formato de grabación', () => {
  const caps = detectCapabilities({ webkitSpeechRecognition: function () {}, navigator: { mediaDevices: { getUserMedia() {} }, standalone: true }, MediaRecorder: function () {}, isSecureContext: true });
  assert.deepEqual(caps, { native: true, recorder: true, secure: true, standalone: true });
  assert.equal(pickRecorderMime({ isTypeSupported: t => t === 'audio/mp4' }), 'audio/mp4');
  assert.equal(pickRecorderMime({ isTypeSupported: t => t.startsWith('audio/webm') }), 'audio/webm;codecs=opus');
  assert.equal(pickRecorderMime(undefined), '');
});
