// dashboard.js — Risk Gauge, Guard Status Cards, Violation Log
import { RiskLevel, RISK_COLORS, riskLevelFromScore } from './guards.js';

const MAX_LOG_ENTRIES = 50;

export class Dashboard {
  constructor() {
    this.logEntries = [];
    this._initElements();
  }

  _initElements() {
    // Risk gauge elements
    this.gaugeBar = document.getElementById('gauge-bar');
    this.gaugeValue = document.getElementById('gauge-value');
    this.gaugeLabel = document.getElementById('gauge-label');

    // Guard status cards
    this.guardCards = {
      ActionSpace: document.getElementById('guard-action'),
      ChainGuard: document.getElementById('guard-chain'),
      LatentSpace: document.getElementById('guard-latent'),
      Guidance: document.getElementById('guard-guidance'),
      WorldModel: document.getElementById('guard-world'),
    };

    // Violation log
    this.logContainer = document.getElementById('violation-log');

    // Stats
    this.frameCounter = document.getElementById('frame-counter');
    this.violationCounter = document.getElementById('violation-counter');
  }

  update(pipelineResult, frameIndex) {
    this._updateGauge(pipelineResult.overallRisk, pipelineResult.riskLevel);
    this._updateGuardCards(pipelineResult.guardReports);
    this._addLogEntries(pipelineResult, frameIndex);
    this._updateStats(frameIndex);
  }

  _updateGauge(risk, level) {
    const pct = Math.min(risk * 100, 100);
    const color = RISK_COLORS[level];
    this.gaugeBar.style.width = `${pct}%`;
    this.gaugeBar.style.background = color;
    this.gaugeValue.textContent = risk.toFixed(3);
    this.gaugeValue.style.color = color;
    this.gaugeLabel.textContent = level.toUpperCase();
    this.gaugeLabel.style.color = color;
  }

  _updateGuardCards(reports) {
    for (const report of reports) {
      const card = this.guardCards[report.name];
      if (!card) continue;

      const level = riskLevelFromScore(report.riskScore);
      const color = RISK_COLORS[level];
      const dot = card.querySelector('.guard-dot');
      const score = card.querySelector('.guard-score');
      const count = card.querySelector('.guard-violations');

      dot.style.background = color;
      dot.style.boxShadow = `0 0 8px ${color}`;
      score.textContent = report.riskScore.toFixed(2);
      score.style.color = color;
      count.textContent = `${report.violations.length} violation${report.violations.length !== 1 ? 's' : ''}`;
    }
  }

  _addLogEntries(result, frameIndex) {
    // Only log violations
    for (const report of result.guardReports) {
      for (const v of report.violations) {
        this.logEntries.unshift({
          frame: frameIndex,
          guard: report.name,
          severity: v.severity,
          message: v.message,
          level: riskLevelFromScore(v.severity),
        });
      }
    }

    // Trim
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.length = MAX_LOG_ENTRIES;
    }

    this._renderLog();
  }

  _renderLog() {
    if (!this.logContainer) return;

    // Efficient: only render top 20
    const toRender = this.logEntries.slice(0, 20);
    const html = toRender.map(entry => {
      const color = RISK_COLORS[entry.level];
      return `<div class="log-entry">
        <span class="log-frame">#${entry.frame}</span>
        <span class="log-guard" style="color:${color}">[${entry.guard}]</span>
        <span class="log-severity" style="color:${color}">${entry.severity.toFixed(1)}</span>
        <span class="log-msg">${escapeHtml(entry.message)}</span>
      </div>`;
    }).join('');

    this.logContainer.innerHTML = html;
  }

  _updateStats(frameIndex) {
    if (this.frameCounter) this.frameCounter.textContent = frameIndex;
    if (this.violationCounter) this.violationCounter.textContent = this.logEntries.length;
  }

  reset() {
    this.logEntries = [];
    this._updateGauge(0, RiskLevel.SAFE);
    for (const name of Object.keys(this.guardCards)) {
      const card = this.guardCards[name];
      if (!card) continue;
      const dot = card.querySelector('.guard-dot');
      const score = card.querySelector('.guard-score');
      const count = card.querySelector('.guard-violations');
      const safeColor = RISK_COLORS[RiskLevel.SAFE];
      dot.style.background = safeColor;
      dot.style.boxShadow = `0 0 8px ${safeColor}`;
      score.textContent = '0.00';
      score.style.color = safeColor;
      count.textContent = '0 violations';
    }
    this._renderLog();
    if (this.frameCounter) this.frameCounter.textContent = '0';
    if (this.violationCounter) this.violationCounter.textContent = '0';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
