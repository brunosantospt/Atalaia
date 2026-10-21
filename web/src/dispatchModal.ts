import type { MultiAgencyDispatch } from './reporting'
import {
  ICON_PROTECAO_CIVIL,
  ICON_PSP,
  ICON_INEM,
  ICON_CLIPBOARD,
  ICON_CHECK,
  ICON_PMA,
} from './icons'
import './dispatchModal.css'

export class DispatchModal {
  private el: HTMLElement | null = null
  private currentTab: 'psp' | 'inem' | 'cmd' = 'psp'

  show(dispatch: MultiAgencyDispatch, onEmit?: () => void) {
    if (this.el) this.el.remove()

    const backdrop = document.createElement('div')
    backdrop.className = 'dispatch-modal-backdrop'

    backdrop.innerHTML = `
      <div class="dispatch-modal">
        <header class="dispatch-header">
          <h2><span class="header-icon">${ICON_PROTECAO_CIVIL}</span> Despacho Operacional Multi-Forças · SIOPS <span class="badge-live">Em Direto · T+${dispatch.currentMin} min</span></h2>
          <button type="button" class="close-btn" title="Fechar (Esc)">✕</button>
        </header>
        <nav class="dispatch-tabs">
          <button type="button" class="dispatch-tab active" data-tab="psp"><span class="tab-svg">${ICON_PSP}</span> PSP / GNR (Trânsito & Vias)</button>
          <button type="button" class="dispatch-tab" data-tab="inem"><span class="tab-svg">${ICON_INEM}</span> INEM (Saúde & Socorro)</button>
          <button type="button" class="dispatch-tab" data-tab="cmd"><span class="tab-svg">${ICON_PROTECAO_CIVIL}</span> Síntese do Comando</button>
        </nav>
        <div class="dispatch-body"></div>
        <footer class="dispatch-footer">
          <button type="button" class="btn-copy">${ICON_CLIPBOARD} Copiar Despacho Formatado</button>
          <div style="display:flex;gap:8px;">
            <button type="button" class="close-btn">Fechar</button>
            <button type="button" class="btn-emit">${ICON_CHECK} Emitir Ordens às Forças no Terreno</button>
          </div>
        </footer>
      </div>
    `

    document.body.appendChild(backdrop)
    this.el = backdrop

    const body = backdrop.querySelector<HTMLElement>('.dispatch-body')!
    const tabs = backdrop.querySelectorAll<HTMLButtonElement>('.dispatch-tab')
    const closeBtns = backdrop.querySelectorAll('.close-btn')
    const copyBtn = backdrop.querySelector<HTMLButtonElement>('.btn-copy')!
    const emitBtn = backdrop.querySelector<HTMLButtonElement>('.btn-emit')!

    const render = () => {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === this.currentTab))
      body.innerHTML = ''

      if (this.currentTab === 'psp') {
        const { roads, cordonM, message } = dispatch.psp
        const urgentCount = roads.filter((r) => r.urgency === 'urgente' || r.urgency === 'cortado').length

        body.innerHTML = `
          <div class="dispatch-stats">
            <div class="stat-pill danger"><strong>${roads.length} vias ameaçadas</strong> (${urgentCount} urgentes)</div>
            <div class="stat-pill">Perímetro de segurança: <strong>${cordonM}m</strong></div>
            <div class="stat-pill">Canal Rádio: <strong>SIRESP Sub-Grupo 04</strong></div>
          </div>
          <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:#8b9096;">Arruamentos Prioritários Detetados pelo Simulador:</div>
          <div class="road-cut-list">
            ${
              roads.length
                ? roads
                    .map(
                      (r) => `
                <div class="road-cut-card ${r.urgency}">
                  <div class="road-name">
                    <span class="road-badge ${r.urgency}">${r.urgency}</span>
                    <span>${r.label}</span>
                    <span style="color:#8b9096;font-size:10px;">(${r.cls})</span>
                  </div>
                  <div style="color:${r.urgency === 'cortado' ? '#ff6b6b' : '#f0a33a'};">
                    ${r.minutesToImpact <= 0 ? 'Fogo na via' : `Impacto em ~${r.minutesToImpact} min`}
                  </div>
                </div>
              `,
                    )
                    .join('')
                : '<div class="road-cut-card">Nenhuma via ameaçada neste instante.</div>'
            }
          </div>
          <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:#8b9096;">Texto Formatado para Envio Imediato (WhatsApp / Rádio):</div>
          <div class="dispatch-text-box">${escapeHtml(message)}</div>
        `
      } else if (this.currentTab === 'inem') {
        const { pmaList, hospital, message, blockedRoads } = dispatch.inem
        body.innerHTML = `
          <div class="dispatch-stats">
            <div class="stat-pill success"><strong>${pmaList.length} Ponto(s) de Socorro / PMA</strong></div>
            <div class="stat-pill">Hospital de Retaguarda: <strong>${hospital}</strong></div>
            <div class="stat-pill danger"><strong>${blockedRoads.length} vias interditas</strong> a ambulâncias</div>
          </div>
          <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:#8b9096;">Postos de Socorro & Pontos de Triagem Ativos:</div>
          <div class="road-cut-list">
            ${
              pmaList.length
                ? pmaList
                    .map(
                      (p) => `
                <div class="road-cut-card preventivo">
                  <div class="road-name">
                    <span class="road-badge preventivo">PMA</span>
                    <span><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_PMA}</span> ${p.name}</span>
                    <span style="color:#8b9096;font-size:10px;">(Margem: ${p.safeBufferMin > 180 ? '>3h' : `${p.safeBufferMin} min`})</span>
                  </div>
                  <div style="color:#4ade80;">
                    ${p.routeKm ? `Corredor seguro: ${p.routeKm.toFixed(1)} km (ETA ~${p.etaMin} min)` : 'No terreno'}
                  </div>
                </div>
              `,
                    )
                    .join('')
                : '<div class="road-cut-card">Nenhum PMA fixado. Clica em "+ Ponto Socorro" no editor para adicionar.</div>'
            }
          </div>
          <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:#8b9096;">Texto Formatado para o CODU / INEM:</div>
          <div class="dispatch-text-box">${escapeHtml(message)}</div>
        `
      } else {
        const { summary, message } = dispatch.cmd
        body.innerHTML = `
          <div class="dispatch-stats">
            <div class="stat-pill">Hora da Situação: <strong>${dispatch.wallClock}</strong></div>
            <div class="stat-pill">Estado: <strong>Ativo / Em Combate</strong></div>
          </div>
          <div class="stat-pill" style="width:100%;">${summary}</div>
          <div style="font-weight:600;font-size:10px;text-transform:uppercase;color:#8b9096;">Registo Completo do Posto de Comando:</div>
          <div class="dispatch-text-box">${escapeHtml(message)}</div>
        `
      }
    }

    render()

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.currentTab = tab.dataset.tab as 'psp' | 'inem' | 'cmd'
        render()
      })
    })

    const close = () => {
      backdrop.remove()
      this.el = null
    }

    closeBtns.forEach((btn) => btn.addEventListener('click', close))
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close()
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        window.removeEventListener('keydown', onKey)
      }
    }
    window.addEventListener('keydown', onKey)

    copyBtn.addEventListener('click', () => {
      let text = dispatch.psp.message
      if (this.currentTab === 'inem') text = dispatch.inem.message
      if (this.currentTab === 'cmd') text = dispatch.cmd.message

      navigator.clipboard.writeText(text).then(() => {
        showToast('Despacho copiado para a área de transferência!')
      })
    })

    emitBtn.addEventListener('click', () => {
      showToast('Despacho transmitido com sucesso ao PCO / Forças no Terreno!')
      if (onEmit) onEmit()
      setTimeout(close, 700)
    })
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showToast(message: string) {
  const toast = document.createElement('div')
  toast.className = 'dispatch-toast'
  toast.textContent = message
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, 2200)
}
