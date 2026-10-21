// One table of language facts. The app and the provider read from here;
// adding a language means adding an entry, not touching core code.

const JAFFNA_GUIDE = `Write colloquial spoken Jaffna Tamil (யாழ்ப்பாணத் தமிழ்), the everyday Sri Lankan Tamil of the Jaffna peninsula, as a Jaffna local would say it out loud. Do not write formal literary Tamil (செந்தமிழ்) and do not use Indian / Chennai colloquial forms.
Jaffna habits to follow:
- Yes is "ஓம்" (never "ஆமா"/"ஆமாம்"). No is "இல்லை" / "இல்ல".
- To talk/speak is "கதை" (கதைக்கிறன், கதைச்சனான்), not "பேசு".
- Polite requests end in "-ங்கோ": வாங்கோ, இருங்கோ, சொல்லுங்கோ, சாப்பிடுங்கோ.
- Polite "you" is "நீங்கள்"; plural/respectful verb endings like "-இறியள்" (எப்பிடி இருக்கிறியள்?). First person often "-இறன்"/"-ஏலாது" style (நான் வாறன், என்னால ஏலாது).
- Common words: இஞ்ச (here), அங்க (there), கெதியா (quickly), கனக்க (a lot), சரியான (very, e.g. சரியான சூடு), வடிவு/வடிவா (beautiful/nicely), பெடியன் (boy), பெட்டை (girl), பிறகு (later), எத்தினை (how many), என்ன மாதிரி (how is it), வாறன் (I'm coming), போட்டு வாறன் (bye, I'll go and come), அம்மம்மா/அப்பப்பா (grandmother/grandfather).
- Keep English loanwords that Jaffna speakers really use in everyday speech (phone, bus, office) when that sounds more natural.`;

export const LANGUAGES = {
  en: {
    id: 'en',
    name: 'English',
    native: 'English',
    button: 'English',
    htmlLang: 'en',
    defaultVoice: 'Puck',
    ttsStyle: 'clear, warm and natural, at a relaxed conversational pace',
    writingGuide: 'Write natural, everyday spoken English. Keep the tone and politeness level of the speaker.',
    romanize: false,
  },
  'ta-jaffna': {
    id: 'ta-jaffna',
    name: 'Jaffna Tamil',
    native: 'யாழ்ப்பாணத் தமிழ்',
    button: 'தமிழ்',
    htmlLang: 'ta-LK',
    defaultVoice: 'Kore',
    ttsStyle: 'a native Sri Lankan Tamil speaker from Jaffna, with a natural Jaffna (Yaazhpaanam) accent and intonation, warm and conversational, not a formal newsreader and not an Indian Tamil accent',
    writingGuide: JAFFNA_GUIDE,
    romanize: true,
  },
};

// The two sides of the conversation, in button order.
export const PAIR = ['en', 'ta-jaffna'];

export function otherSide(id) {
  return PAIR[0] === id ? PAIR[1] : PAIR[0];
}

// A handful of Gemini prebuilt voices that tend to work well across languages.
export const VOICES = ['Kore', 'Puck', 'Aoede', 'Charon', 'Leda', 'Orus', 'Zephyr', 'Fenrir', 'Sulafat', 'Achird'];
