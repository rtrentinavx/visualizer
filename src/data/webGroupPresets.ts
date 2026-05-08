export interface WebGroupPreset {
  id: string;
  name: string;
  description: string;
  category: 'productivity' | 'social' | 'streaming' | 'development' | 'security';
  fqdns: string[];
}

export const WEBGROUP_PRESETS: WebGroupPreset[] = [
  {
    id: 'preset-saas',
    name: 'SaaS Essentials',
    description: 'Common business productivity applications',
    category: 'productivity',
    fqdns: [
      '*.office.com',
      '*.office365.com',
      '*.sharepoint.com',
      '*.salesforce.com',
      '*.zoom.us',
      '*.slack.com',
      '*.slack-edge.com',
      '*.googleworkspace.com',
      '*.google.com',
      '*.gstatic.com',
      '*.microsoft.com',
      '*.msauth.net',
      '*.msftidentity.com',
    ],
  },
  {
    id: 'preset-social',
    name: 'Social Media',
    description: 'Popular social networking platforms',
    category: 'social',
    fqdns: [
      '*.facebook.com',
      '*.instagram.com',
      '*.twitter.com',
      '*.x.com',
      '*.linkedin.com',
      '*.tiktok.com',
      '*.snapchat.com',
      '*.reddit.com',
      '*.pinterest.com',
    ],
  },
  {
    id: 'preset-streaming',
    name: 'Streaming Services',
    description: 'Video and audio streaming platforms',
    category: 'streaming',
    fqdns: [
      '*.netflix.com',
      '*.youtube.com',
      '*.spotify.com',
      '*.twitch.tv',
      '*.disneyplus.com',
      '*.hulu.com',
      '*.hbomax.com',
      '*.primevideo.com',
      '*.apple.tv',
    ],
  },
  {
    id: 'preset-devtools',
    name: 'Development Tools',
    description: 'Developer and engineering tools',
    category: 'development',
    fqdns: [
      '*.github.com',
      '*.gitlab.com',
      '*.npmjs.com',
      '*.pypi.org',
      '*.docker.io',
      '*.stackoverflow.com',
      '*.jetbrains.com',
      '*.vscode-unpkg.net',
      '*.openai.com',
      '*.anthropic.com',
    ],
  },
  {
    id: 'preset-gambling',
    name: 'Gambling Blocklist',
    description: 'Common online gambling and betting sites',
    category: 'security',
    fqdns: [
      '*.bet365.com',
      '*.draftkings.com',
      '*.fanduel.com',
      '*.betmgm.com',
      '*.caesars.com',
      '*.betfair.com',
      '*.paddypower.com',
      '*.williamhill.com',
      '*.bovada.lv',
      '*.betway.com',
    ],
  },
  {
    id: 'preset-adnetworks',
    name: 'Ad Networks',
    description: 'Major advertising and tracking networks',
    category: 'security',
    fqdns: [
      '*.doubleclick.net',
      '*.googleadservices.com',
      '*.googlesyndication.com',
      '*.facebook.com',
      '*.ads-twitter.com',
      '*.amazon-adsystem.com',
      '*.ads.linkedin.com',
      '*.outbrain.com',
      '*.taboola.com',
      '*.criteo.com',
    ],
  },
];

export function getCategoryLabel(category: WebGroupPreset['category']) {
  switch (category) {
    case 'productivity': return 'Productivity';
    case 'social': return 'Social';
    case 'streaming': return 'Streaming';
    case 'development': return 'Development';
    case 'security': return 'Security';
  }
}

export function getCategoryColor(category: WebGroupPreset['category']) {
  switch (category) {
    case 'productivity': return '#3b82f6';
    case 'social': return '#8b5cf6';
    case 'streaming': return '#ec4899';
    case 'development': return '#10b981';
    case 'security': return '#ef4444';
  }
}
