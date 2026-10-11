/** Question ideas that work for any location, grouped so the board is easy to browse. */
export interface QuestionCategory {
  id: string;
  label: string;
  emoji: string;
  questions: string[];
}

export const GENERIC_QUESTIONS: readonly QuestionCategory[] = [
  {
    id: 'senses',
    label: 'Senses',
    emoji: '👃',
    questions: [
      'What’s the first thing you hear here?',
      'What does it smell like?',
      'Is it bright or dim here?',
      'Is it warm or cold?',
      'What do you touch most here?',
      'Is it loud enough to need to shout?',
      'What colour do you notice most?',
      'Would you take your shoes off here?',
      'What do you taste here, if anything?',
      'Is the air fresh here?',
    ],
  },
  {
    id: 'people',
    label: 'People',
    emoji: '🧑‍🤝‍🧑',
    questions: [
      'Who works here?',
      'Who would you bring with you?',
      'Would a five-year-old like it here?',
      'Would your grandparents like it here?',
      'Are there many people here at once?',
      'Who is in charge here?',
      'Do people talk to strangers here?',
      'Who would never come here?',
      'Is it a good place for a first date?',
      'Do people come here alone?',
    ],
  },
  {
    id: 'clothing',
    label: 'Clothing',
    emoji: '👕',
    questions: [
      'What are you wearing right now?',
      'Is there a uniform here?',
      'What would be the wrong thing to wear here?',
      'Do you dress up to come here?',
      'What’s on your feet?',
      'Would you need a coat?',
      'Do you change clothes when you get here?',
      'Would you wear something on your head here?',
      'Do your clothes get dirty here?',
      'Would sunglasses help here?',
    ],
  },
  {
    id: 'time',
    label: 'Time',
    emoji: '🕰️',
    questions: [
      'What time of day is best to come here?',
      'How long do people usually stay?',
      'Is it busier at the weekend?',
      'What season suits this place best?',
      'Is it open at night?',
      'How often do you come here?',
      'When did you first come here?',
      'Is it the same every time you come?',
      'Do you have to book ahead?',
      'Would you stay here all day?',
    ],
  },
  {
    id: 'money',
    label: 'Money',
    emoji: '💰',
    questions: [
      'Is it expensive here?',
      'Do you pay before or after?',
      'How do you pay here?',
      'Would you tip here?',
      'What’s the most expensive thing here?',
      'Is it worth the money?',
      'Do people make a living here?',
      'Could you come here for free?',
      'Do you need to bring cash?',
      'Would you buy a souvenir here?',
    ],
  },
  {
    id: 'mood',
    label: 'Mood',
    emoji: '😊',
    questions: [
      'How do you feel when you arrive?',
      'How do you feel when you leave?',
      'Is this a place for celebrating?',
      'Would you be nervous here?',
      'Is it relaxing here?',
      'What would ruin a visit here?',
      'Would you come back tomorrow?',
      'Is it romantic here?',
      'Do people laugh a lot here?',
      'What’s the best thing that could happen here?',
    ],
  },
];

/** For the spy: questions that fit almost anywhere, so they never give the spy away. */
export const SPY_SAFE_QUESTIONS: readonly string[] = [
  'How did you get here today?',
  'Have you been here before?',
  'Would you come here again?',
  'Who would you bring here?',
  'What’s your favourite thing about this place?',
  'Is it busy right now?',
  'How long are you staying?',
  'Is it better in summer or winter?',
  'Would you recommend it to a friend?',
  'What would you change about this place?',
];

/** For the spy: questions that narrow things down without sounding lost. */
export const SPY_FISHING_QUESTIONS: readonly string[] = [
  'Is it indoors or outdoors?',
  'What’s the noisiest thing here?',
  'What are you holding right now?',
  'What do you need to bring with you?',
  'Who would you expect to see working here?',
  'What do you wear on your feet here?',
  'Is it a place for work or for fun?',
  'What’s the smell like?',
];

/** For the spy: how to blend in. */
export const SPY_BLUFF_TIPS: readonly string[] = [
  'Answer with feelings and opinions (“it can get a bit much”), not facts.',
  'Ask the question you were just asked to someone else: it sounds natural and buys time.',
  'Listen for two answers that agree: that’s a clue to the location.',
  'Cross off places on the Locations board as answers rule them out.',
  'Don’t go quiet. A spy who stops talking gets voted out.',
  'Pick a suspect early and nudge the table towards them.',
  'If you’re caught, you still get one guess: keep the shortlist ready.',
  'Laugh along with the in-jokes, even when you don’t get them.',
];

/** For whoever answers a question. */
export const ANSWER_TIP =
  'Good answers stay vague: true for this place, but true for a few others too. Too exact and the spy learns it; too vague and you look like the spy.';
