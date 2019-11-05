/*
 CLARIFICATION: event(s) vs course(s)
 - events are "base" events as returned by the /events/ API endpoint.
   They describe a normal week of the year
 - courses are events, with deletions, additions and offdays applied.
   They have a `date` attribute and describe a *particular* week, 
   and thus are tied to a date range, a specific week of the year.
*/

// Use moment-range
import { firstBy } from "thenby"
import {
  parseISO,
  startOfWeek,
  endOfWeek,
  getISODay,
  getISOWeek,
  isWithinInterval,
  eachDayOfInterval,
  isBefore,
  isSameDay,
  isDate,
  isAfter,
  setMinutes,
  setSeconds,
  setHours,
  endOfDay,
  startOfDay,
  isValid,
} from "date-fns"
import { getMutations } from "./index"

export const state = () => ({
  events: [],
  mutations: [],
})

const _mergeDateAndTime = (date, time) => {
  // Assuming `time` uses the ISO format "HH:mm:ss"
  const [hours, minutes, seconds] = time.split(':')
  date = setHours(date, hours)
  date = setMinutes(date, minutes)
  date = setSeconds(date, seconds)
  return date
}

export const getters = {
  events: (state, getters) => state.events,
  event: (state, getters) => (value, prop = "uuid") =>
    getters.events.find((o) => o[prop] === value) || null,
  mutations: (state, getters) => state.mutations,
  mutation: (state, getters) => (value, prop = "uuid") =>
    getters.mutations.find((o) => o[prop] === value) || null,
  course: (state, getters) => (value, prop = "uuid") =>
    getters.currentWeekCourses.find((o) => o[prop] === value) || null,
  trimester: (state, getters, rootState, rootGetters) => (idx) => {
    /*
     *  Returns an Interval to test dates against using isWithinInterval(date, Interval)
     */
    // Bounds
    const yearStart = rootGetters["settings/value"]("year_start")
    const trimester2start = rootGetters["settings/value"]("trimester_2_start")
    const trimester3start = rootGetters["settings/value"]("trimester_3_start")
    const yearEnd = rootGetters["settings/value"]("year_end")
    // Ranges
    const trimester1 = { start: yearStart, end: trimester2start }
    const trimester2 = { start: trimester2start, end: trimester3start }
    const trimester3 = { start: trimester3start, end: yearEnd }
    // Choose which interval to return
    if (idx === 1) return trimester1
    if (idx === 2) return trimester2
    if (idx === 3) return trimester3
    // Invalid index
    throw new Error(`Trimester #${idx} does not exist.`)
  },
  isOffday: (state, getters, rootState, rootGetters) => (date) => {
    /* Check if the given `date` is an offday, by using the
     * `offdays` setting.
     */
    // Loop through each date/dateinterval in the `offdays` settings
    rootGetters["settings/value"]("offdays").forEach((dateOrInterval) => {
      if (isDate(dateOrInterval)) {
        // If it's a regular date, check if they're the same day
        if (isSameDay(date, dateOrInterval)) return true
      } else {
        // If it's a range, check if the given date is within it
        try {
          if (isWithinInterval(date, dateOrInterval)) return true
        } catch (error) {
          // console.error(error)
        }
      }
    })
    /* At this point, if no value was returned, it means that
     * nothing was found in the list of offdays: return false
     */
    return false
  },
  currentTrimester: (state, getters, rootState) => {
    /* Returns the index of the current trimester.
     * Returns null if the current date is outside any trimester
     */
    const now = rootState.now
    const t1 = getters.trimester(1)
    const t2 = getters.trimester(2)
    const t3 = getters.trimester(3)
    try {
      if (isWithinInterval(now, t1)) return 1
      if (isWithinInterval(now, t2)) return 2
      if (isWithinInterval(now, t3)) return 3
    } catch (error) {
      // console.error(error)
      // console.error({ t1, t2, t3, now })
    }
    return null
  },
  mutationsOf: (state, getters, rootState) => ({ event, date }) => {
    /* Provided an event and a date, returns either a schedule mutation object
     * or null if no mutation matches the arguments given.
     */
    let mutations = getters.mutations
    if (event) {
      // Filter by the given event.
      mutations = mutations.filter((o) => o.event.uuid === event.uuid)
    }
    if (date) {
      /* Filter with the provided date, whether the events are...
       * - rescheduled to that week, or
       * - deleted from that week
       */
      mutations = mutations.filter((o) => {
        let ret = false
        // If the mutation's deleted field is not null, compare deletion date & current date
        if (o.deleted) ret = isSameDay(o.deleted, date)
        // If the mutation's rescheduled field is not null, compare reschedule date & current date
        if (o.rescheduled) ret = ret || isSameDay(o.rescheduled, date)
        return ret
      })
    }
    return mutations
  },
  currrentWeekMutations: (state, getters, rootState) => {
    let mutations = []
    const week = {
      start: startOfWeek(rootState.now),
      end: endOfWeek(rootState.now),
    }
    eachDayOfInterval(week).forEach((day) => {
      const mutationsOfDay = getters.mutationsOf({ date: day, event: null })
      mutations = [...mutations, ...mutationsOfDay]
    })
  },
  orderCourses: (state, getters, rootState, rootGetters) => (courses) =>
    /* Sort courses objects by day & starting date
     */
    [...courses].sort(
      firstBy("day").thenBy((o1, o2) => isBefore(o1.start, o2.start))
    ),

  coursesIn: (state, getters, rootState, rootGetters) => (start, end=null, includeDeleted=false) => {
    if (end===null) {
      start = startOfDay(start)
      end = endOfDay(start)
    }
    const courses = []
    for (const day of eachDayOfInterval({ start, end })) {
      // If this day is an offday, it doesn't contain any events
      if (getters.isOffday(day)) continue
      // Get the events for that day
      const events = getters.events.filter(
        (o) =>
          o.day === getISODay(day) &&
          [getters.weekType(day), "BOTH"].includes(o.week_type)
      )
      // Loop through the events
      events.forEach((event) => {
        // Handle mutations
        const mutations = getters.mutationsOf(event, day)
        /* getters.mutationsOf returns an array of mutations, but here we only want one.
         * Since two mutations should never be on the same event & same day anyway, we just take
         * the array's first item (or set to null if no mutations were found.)
         */
        const mutation = mutations.length
          ? mutations[0]
          : { deleted: null, rescheduled: null }
        if (!mutations.deleted || includeDeleted)
          courses.push({
            ...event,
            ...mutation,
            start: _mergeDateAndTime(day, event.start),
            end: _mergeDateAndTime(day, event.end),
            placeholder: false // See getters.courseOrPlaceholder
          })
      })
    }
    return getters.orderCourses(courses)
  },
  currentWeekCourses: (state, getters, rootState) =>
    /* Gets courses in the current week.
     */
    getters.coursesIn(startOfWeek(rootState.now), endOfWeek(rootState.now)),
  weekType: (state, getters, rootState, rootGetters) => (date) => {
    // TODO: explain this better, can't understand the logic I've written (it works tho)
    date = date || rootState.now
    // get base Q1/Q2
    const base = rootGetters["settings/value"]("starting_week_type")
    const start = rootGetters["settings/value"]("year_start")
    // convert to week-of-year number, and get if its even or odd.
    // tested date will be [base] (Q1 or Q2) if its also even.
    const startingWeekIsEven = getISOWeek(start) % 2 === 0
    const other = base === "Q1" ? "Q2" : "Q1"
    return getISOWeek(date) % 2 === 0 && startingWeekIsEven ? base : other
  },
  courseOrPlaceholder: (state, getters, rootState, rootGetters) => (course) => {
    /* If the given course is null, return a placeholder course.
      Useful in some cases where we want to access a course's subject
      no matter if it exists or not (eg. current courses's subject, fall back to placeholder)
    */
    console.log(course)
    if (course) return course

    return {
      subject: rootGetters['subjects/placeholder'],
      placeholder: true
    }
  },
  currentCourse: (state, getters, rootState, rootGetters) => {
    const course = getters.currentWeekCourses.find(
      (o) =>
        // Is the same day
        isSameDay(o.start, rootState.now) &&
        // Has started before now
        isBefore(o.start, rootState.now) &&
        // Hasn't finished yet or finished right this (mili)second
        isAfter(o.end, rootState.now)
    )
    return course || null
  },
  nextCourses: (state, getters, rootState, rootGetters) => (from = null) => {
    from = from || rootState.now
    let courses = getters.currentWeekCourses.filter(
      (o) =>
        // Is the same week day
        isSameDay(o.start, from) &&
        // Hasn't started yet
        isAfter(o.start, from)
    )
    // Make sure the events are sorted
    courses = getters.orderCourses(courses)
    // Get the soonest courses or an empty array
    return courses || []
  },
  nextCoursesOf: (state, getters, rootState, rootGetters) => (value, what = 'subject') => {
    const nextCourses = getters.nextCourses()
    if (!nextCourses.length) return []
    if (what === 'subject') {
      return nextCourses.filter((o) => o.subject.uuid === value)
    }
    return nextCourses.filter((o) => o[what] === value)
  },
  todayCourses: (state, getters, rootState, rootGetters) =>
    getters.coursesIn(rootState.now),
  tomorrowCourses: (state, getters, rootState, rootGetters) =>
    getters.coursesIn(rootState.tomorrow),
  upcomingCourse: (state, getters, rootState) =>
    getters.nextCourses()[0],
  nextCourseOf: (state, getters) => (value, what = 'subject') =>
    getters.nextCoursesOf(value, what)[0],
  startOfDay: (state, getters, rootState) => (start, end=null) => {
    start = start || rootState.now
    const courses = getters.orderCourses(getters.coursesIn(start, end))
    if(!courses.length) return null
    return courses[0].start
  },
  endOfDay: (state, getters, rootState) => (start, end=null) => {
    start = start || rootState.now
    const courses = getters.orderCourses(getters.coursesIn(start, end))
    if(!courses.length) return null
    return courses[courses.length-1].end
  }
}

export const mutations = {
  ...getMutations("event", (o) => o, false),
  ...getMutations("mutation", (o) => o, false),
}

export const actions = {
  async load ({ dispatch }, force = false) {
    await dispatch('loadEvents', force)
    await dispatch('loadMutations', force)
  },
  async loadEvents({ commit, state }, force = false) {
    if (!force && state.events.length) return
    try {
      const { data } = await this.$axios.get(`/events/`)
      // console.log(`[from API] GET /events/: OK`)
      if (data) commit("SET_EVENTS", data)
    } catch (error) {
      // console.error(`[from API] GET /events/: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async loadMutations({ commit, state }, force = false) {
    if (!force && state.mutations.length) return
    try {
      const { data } = await this.$axios.get(`/events-mutations/`)
      // console.log(`[from API] GET /events-mutations/: OK`)
      if (data) commit("SET_MUTATIONS", data)
    } catch (error) {
      // console.error(`[from API] GET /events-mutations/: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async postEvent({ commit, dispatch }, event, force = false) {
    if(!force) {
      const validation = await dispatch('validatePostEvent', mutation)
      // if validation is not true, it's the error message
      if (validation !== true) return validation 
    }
    try {
      const { data } = await this.$axios.post(`/events/`, event)
      if (data) commit("ADD_EVENT", data)
      // console.log("[from API] POST /events/: OK")
    } catch (error) {
      // console.error(`[from API] POST /events/: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async validatePostEvent({ getters, rootGetters }, event) {
    //TODO: include the object fields that errored in errorMessages
    const errorMessages = {}

    // start, end, subject, day and week_type are specified
    if(!( "start" in event ))
      return "Veuillez spécifier l'heure de début du cours"
    if(!( "end" in event ))
      return "Veuillez spécifier l'heure de fin du cours"
    if(!( event.subject && event.subject.uuid ))
      return "Veuillez spécifier la matière du cours"
    if(!( "day" in event ))
      return "Veuillez choisir le jour du cours"
    if(!( "week_type" in event ))
      return "Veuillez sélectionner la semaine: Q1, Q2 ou les deux"

    // start & end are Date objects
    if(!( startDefined && isValid(parse(event.start, 'HH:mm')) ))
      return "Veuillez rentrer une heure de début valide, au format HH:MM (24 heures)"
    if(!( endDefined && isValid(parse(event.end, 'HH:mm')) ))
      return "Veuillez rentrer une heure de fin valide, au format HH:MM (24 heures)"

    // start is before end
    if(!( startIsDate && endIsDate && isBefore(start, end) ))
      return "L'heure du début du cours est après l'heure de fin !"

    // day is a valid week day integer
    if(!( dayDefined && [1, 2, 3, 4, 5, 6, 7].includes(event.day) ))
      return `Veuillez un jour de la semaine valide`

    // week_type is either Q1, Q2 or BOTH
    if(!( weekTypeDefined && ["Q1", "Q2", "BOTH"].includes(event.week_type) ))
      return "Veuillez choisir un type de semaine correct: Q1, Q2 ou les deux"

    // Check if no event exist at this date
    const doesNotOverlap = !getters.events.filter((o) => 
      o.start === event.start &&
      o.end === event.end &&
      o.day === event.day && 
      (o.week_type === event.week_type || o.week_type === 'BOTH')
    ).length

    if(!doesNotOverlap) return "Un autre cours existe déjà ici !"

    // Subject is specified & exists
    if(!( subjectDefined && rootGetters['subjects/all'].map((o) => o.uuid).includes(event.subject.uuid) ))
      return `La matière ${'name' in event.subject ? '"' + event.subject.name + '"' : 'sélectionnée'} n'existe pas`

    return true
  },

  async postMutation({ commit, dispatch }, mutation, force = false) {
    if(!force) {
      const validation = await dispatch('validatePostMutation', mutation)
      if (!validation.result) return validation.errors
    }
    try {
      const { data } = await this.$axios.post(`/events-mutations/`, mutation)
      if (data) commit("ADD_MUTATION", data)
      // console.log("[from API] POST /events-mutations/: OK")
    } catch (error) {
      // console.error(`[from API] POST /events-mutations/: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }

    return {
      result: isValidated,
      // Gets the value of the variable to know if the check failed
      errors: Object.entries(errorMessages).filter((o) => !eval(o[0])) 
    }
  },

  async validatePostMutation({ commit, getters, rootGetters }, mutation) {
    const [ start, end ] = [ mutation.rescheduled_start, mutation.rescheduled_end ]
    const isRescheduled = start && end
    // Check if the start and end date are in the correct order
    const startIsBeforeEnd = isRescheduled && isBefore(start, end)
    // Check if the rescheduled date is free
    const doesNotOverlap = isRescheduled && startIsBeforeEnd && getters.coursesIn(start, end, false).length <= 0
    // Check if the required fields are present
    const subjectNotEmpty = mutation.subject && mutation.subject.uuid
    const subjectExists = subjectNotEmpty && rootGetters['subjects/all'].map((o) => o.uuid).includes(mutation.subject.uuid)
    
    const isValidated = subjectNotEmpty && subjectExists && (isRescheduled ? startIsBeforeEnd && doesNotOverlap : true)
    const errorMessages = {
      startIsBeforeEnd: "Les dates doivent être dans le bon ordre",
      doesNotOverlap: "La date choisie n'est pas libre",
      subjectNotEmpty: "Veuillez choisir une matière",
      subjectExists: "La matière choisie n'existe pas"
    }

    return getValidationObject(isValidated, errorMessages)

  },

  async patchEvent({ commit }, uuid, modifications) {
    try {
      const { data } = await this.$axios.patch(`/events/${uuid}`, modifications)
      if (data) commit("PATCH_EVENT", uuid, data)
      // console.log(`[from API] PATCH /events/${uuid}: OK`)
    } catch (error) {
      // console.error(`[from API] PATCH /events/${uuid}: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async patchMutation({ commit }, uuid, modifications) {
    try {
      const { data } = await this.$axios.patch(
        `/events-mutations/${uuid}`,
        modifications
      )
      if (data) commit("PATCH_MUTATION", uuid, data)
      // console.log(`[from API] PATCH /events-mutations/${uuid}: OK`)
    } catch (error) {
      // console.error(`[from API] PATCH /events-mutations/${uuid}: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async deleteEvent({ commit }, uuid) {
    try {
      const { data } = await this.$axios.delete(`/events/${uuid}`)
      if (data) commit("DEL_EVENT", uuid)
      // console.log(`[from API] DELETE /events/${uuid}: OK`)
    } catch (error) {
      // console.error(`[from API] DELETE /events/${uuid}: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },

  async deleteMutation({ commit }, uuid) {
    try {
      const { data } = await this.$axios.delete(`/events-mutations/${uuid}`)
      if (data) commit("DEL_MUTATION", uuid)
      // console.log(`[from API] DELETE /events-mutations/${uuid}: OK`)
    } catch (error) {
      // console.error(`[from API] DELETE /events-mutations/${uuid}: Error`)
      try {
        // console.error(error.response.data)
      } catch (_) {
        // console.error(error)
      }
    }
  },
}
