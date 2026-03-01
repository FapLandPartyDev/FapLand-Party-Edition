import fs from 'node:fs';

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function analyze(filePath) {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const actions = content.actions;
    if (!actions || actions.length < 2) return null;

    const durationMs = actions[actions.length - 1].at - actions[0].at;
    const durationSec = durationMs / 1000;
    const points = actions.length;
    const pointRate = points / durationSec;

    let velocitySamples = 0;
    let velocitySum = 0;

    for (let index = 1; index < actions.length; index += 1) {
        const previous = actions[index - 1];
        const current = actions[index];
        const deltaTimeSec = (current.at - previous.at) / 1000;
        if (deltaTimeSec <= 0) continue;
        const deltaPos = Math.abs(current.pos - previous.pos);
        const velocity = deltaPos / deltaTimeSec;
        velocitySamples += 1;
        velocitySum += velocity;
    }

    const avgVelocity = velocitySum / velocitySamples;
    const lengthMin = durationSec / 60;
    
    // NEW difficulty calculation logic
    const MIN_V = 230;
    const MAX_V = 1600;
    const MIN_P = 2;
    const MAX_P = 40;

    const pointNorm = clamp((Math.log1p(pointRate) - Math.log1p(MIN_P)) / (Math.log1p(MAX_P) - Math.log1p(MIN_P)), 0, 1);
    const velocityNorm = clamp((Math.log1p(avgVelocity) - Math.log1p(MIN_V)) / (Math.log1p(MAX_V) - Math.log1p(MIN_V)), 0, 1);
    const lengthNorm = clamp(lengthMin / 3, 0, 1);

    const score = 0.85 * velocityNorm + 0.1 * pointNorm + 0.05 * lengthNorm;
    const difficulty = clamp(Math.round(1 + score * 4), 1, 5);

    return {
        file: filePath.split('/').pop(),
        avgVelocity: Math.round(avgVelocity),
        pointRate: pointRate.toFixed(2),
        score: score.toFixed(3),
        difficulty
    };
}

const files = process.argv.slice(2);
const results = files.map(f => {
    try {
        return analyze(f);
    } catch (e) {
        return { file: f, error: e.message };
    }
});
console.log(JSON.stringify(results, null, 2));
