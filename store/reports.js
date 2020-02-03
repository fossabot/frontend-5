import { formatISO } from 'date-fns'
import { firstBy } from 'thenby'
import { getValidator, getMutations } from './index'
const UAParser = require('ua-parser-js')

export const state = () => ({
  reports: [],
  loaded: false
})

export const getters = {
  all: ({ reports }) => reports,
  one: ({ reports }) => (what = 'uuid', value) =>
    reports.find((o) => o[what] === value),
  latest: ({ reports }) =>
    reports.length > 0 ? [...reports].sort(firstBy('added'))[0] : null,
  validate: getValidator({
    fieldNames: {
      type: { gender: 'M', name: 'type de demande' },
      title: { gender: 'M', name: 'titre' },
      content: { gender: 'M', name: 'message' },
      happened: { gender: 'M', name: 'date' }
    },
    resourceName: { gender: 'M', name: 'Rapport' },
    constraints: {
      notEmpty: ['title', 'type', 'content']
    },
    debug: true
  })
}

export const mutations = {
  ...getMutations('report'),
  POSTLOAD: (state) => (state.loaded = true)
}

export const actions = {
  async load({ commit }, force = false) {
    if (!force && state.loaded) return
    try {
      const { data } = await this.$axios.get(`/reports/`)
      if (data) {
        commit('SET', data)
        commit('POSTLOAD')
      }
    } catch (error) {
      this.$toast.error('Impossible de charger les rapports', {
        icon: 'error_outline'
      })
      console.error(error)
    }
  },
  async post({ getters, commit }, { report, force }) {
    force = force || false
    const { browser, cpu, os } = UAParser(window.userAgent)
    if ('happened' in report) report.happened = formatISO(report.happened)
    report = {
      user: this.$auth.user.id,
      browser: `${browser.name}/${browser.version}`,
      os: `${cpu.architecture}/${os.name}/${os.version}`,
      language: 'fr',
      ...report
    }
    if (!force) {
      const validation = getters.validate(report)
      if (!validation.validated) return false
    }
    try {
      const res = await this.$axios.post('reports/', report)
      const { data } = this.$axios.get(`/reports/${res.data.uuid}/`)
      commit('ADD', data)
      return true
    } catch (error) {
      // eslint-disable-next-line
      console.error(error)
      return false
    }
  }
}
