// ─────────────────────────────────────────────────────────────────────────────
//  Brand + industry classifier for the dataset reduction pipeline
//
//  Classifies a URL into:
//    - brand        : human-readable brand name (legitimate side)
//    - industry     : broad industry category
//    - impersonatedBrand : brand being spoofed (phishing side)
//    - isKnownBrand : true if domain matches the curated brand map
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  brand: string;
  industry: string;
  impersonatedBrand: string;
  isKnownBrand: boolean;
}

// ── Apex-domain → { brand, industry } ────────────────────────────────────────
// Covers ~200 globally recognised domains.  Add more as needed.
const DOMAIN_MAP: Record<string, { brand: string; industry: string }> = {
  // ── Technology ──────────────────────────────────────────────────────────
  'google.com':          { brand: 'Google',          industry: 'technology' },
  'google.co.in':        { brand: 'Google',          industry: 'technology' },
  'google.co.uk':        { brand: 'Google',          industry: 'technology' },
  'google.com.au':       { brand: 'Google',          industry: 'technology' },
  'google.de':           { brand: 'Google',          industry: 'technology' },
  'google.fr':           { brand: 'Google',          industry: 'technology' },
  'google.com.br':       { brand: 'Google',          industry: 'technology' },
  'microsoft.com':       { brand: 'Microsoft',       industry: 'technology' },
  'live.com':            { brand: 'Microsoft',       industry: 'technology' },
  'microsoftonline.com': { brand: 'Microsoft',       industry: 'technology' },
  'office.com':          { brand: 'Microsoft',       industry: 'technology' },
  'office365.com':       { brand: 'Microsoft',       industry: 'technology' },
  'apple.com':           { brand: 'Apple',           industry: 'technology' },
  'icloud.com':          { brand: 'Apple',           industry: 'technology' },
  'github.com':          { brand: 'GitHub',          industry: 'technology' },
  'github.io':           { brand: 'GitHub',          industry: 'technology' },
  'gitlab.com':          { brand: 'GitLab',          industry: 'technology' },
  'stackoverflow.com':   { brand: 'Stack Overflow',  industry: 'technology' },
  'stackexchange.com':   { brand: 'Stack Exchange',  industry: 'technology' },
  'adobe.com':           { brand: 'Adobe',           industry: 'technology' },
  'adobelogin.com':      { brand: 'Adobe',           industry: 'technology' },
  'oracle.com':          { brand: 'Oracle',          industry: 'technology' },
  'ibm.com':             { brand: 'IBM',             industry: 'technology' },
  'intel.com':           { brand: 'Intel',           industry: 'technology' },
  'nvidia.com':          { brand: 'NVIDIA',          industry: 'technology' },
  'openai.com':          { brand: 'OpenAI',          industry: 'technology' },
  'chatgpt.com':         { brand: 'ChatGPT',         industry: 'technology' },
  'anthropic.com':       { brand: 'Anthropic',       industry: 'technology' },
  'salesforce.com':      { brand: 'Salesforce',      industry: 'technology' },
  'sap.com':             { brand: 'SAP',             industry: 'technology' },
  'atlassian.com':       { brand: 'Atlassian',       industry: 'technology' },
  'jira.com':            { brand: 'Jira',            industry: 'technology' },
  'figma.com':           { brand: 'Figma',           industry: 'technology' },
  'canva.com':           { brand: 'Canva',           industry: 'technology' },
  'hubspot.com':         { brand: 'HubSpot',         industry: 'technology' },
  'shopify.com':         { brand: 'Shopify',         industry: 'ecommerce' },
  'wix.com':             { brand: 'Wix',             industry: 'technology' },
  'wordpress.com':       { brand: 'WordPress',       industry: 'technology' },
  'wordpress.org':       { brand: 'WordPress',       industry: 'technology' },
  'squarespace.com':     { brand: 'Squarespace',     industry: 'technology' },
  // ── Social Media ────────────────────────────────────────────────────────
  'facebook.com':        { brand: 'Facebook',        industry: 'social_media' },
  'fb.com':              { brand: 'Facebook',        industry: 'social_media' },
  'instagram.com':       { brand: 'Instagram',       industry: 'social_media' },
  'twitter.com':         { brand: 'X (Twitter)',     industry: 'social_media' },
  'x.com':               { brand: 'X (Twitter)',     industry: 'social_media' },
  'linkedin.com':        { brand: 'LinkedIn',        industry: 'social_media' },
  'reddit.com':          { brand: 'Reddit',          industry: 'social_media' },
  'discord.com':         { brand: 'Discord',         industry: 'social_media' },
  'snapchat.com':        { brand: 'Snapchat',        industry: 'social_media' },
  'pinterest.com':       { brand: 'Pinterest',       industry: 'social_media' },
  'tiktok.com':          { brand: 'TikTok',          industry: 'social_media' },
  'telegram.org':        { brand: 'Telegram',        industry: 'social_media' },
  'whatsapp.com':        { brand: 'WhatsApp',        industry: 'social_media' },
  'tumblr.com':          { brand: 'Tumblr',          industry: 'social_media' },
  'quora.com':           { brand: 'Quora',           industry: 'social_media' },
  'twitch.tv':           { brand: 'Twitch',          industry: 'entertainment' },
  // ── Email ───────────────────────────────────────────────────────────────
  'gmail.com':           { brand: 'Gmail',           industry: 'email' },
  'outlook.com':         { brand: 'Outlook',         industry: 'email' },
  'hotmail.com':         { brand: 'Outlook',         industry: 'email' },
  'yahoo.com':           { brand: 'Yahoo Mail',      industry: 'email' },
  'yahoo.co.in':         { brand: 'Yahoo Mail',      industry: 'email' },
  'yahoo.co.uk':         { brand: 'Yahoo Mail',      industry: 'email' },
  'proton.me':           { brand: 'ProtonMail',      industry: 'email' },
  'protonmail.com':      { brand: 'ProtonMail',      industry: 'email' },
  'tutanota.com':        { brand: 'Tutanota',        industry: 'email' },
  'zoho.com':            { brand: 'Zoho',            industry: 'email' },
  // ── Cloud ───────────────────────────────────────────────────────────────
  'amazonaws.com':       { brand: 'AWS',             industry: 'cloud' },
  'aws.amazon.com':      { brand: 'AWS',             industry: 'cloud' },
  'azure.com':           { brand: 'Azure',           industry: 'cloud' },
  'digitalocean.com':    { brand: 'DigitalOcean',    industry: 'cloud' },
  'cloudflare.com':      { brand: 'Cloudflare',      industry: 'cloud' },
  'heroku.com':          { brand: 'Heroku',          industry: 'cloud' },
  'linode.com':          { brand: 'Linode',          industry: 'cloud' },
  'vultr.com':           { brand: 'Vultr',           industry: 'cloud' },
  'vercel.com':          { brand: 'Vercel',          industry: 'cloud' },
  'netlify.com':         { brand: 'Netlify',         industry: 'cloud' },
  'fastly.com':          { brand: 'Fastly',          industry: 'cloud' },
  // ── E-commerce ──────────────────────────────────────────────────────────
  'amazon.com':          { brand: 'Amazon',          industry: 'ecommerce' },
  'amazon.in':           { brand: 'Amazon',          industry: 'ecommerce' },
  'amazon.co.uk':        { brand: 'Amazon',          industry: 'ecommerce' },
  'amazon.com.au':       { brand: 'Amazon',          industry: 'ecommerce' },
  'amazon.de':           { brand: 'Amazon',          industry: 'ecommerce' },
  'amazon.ca':           { brand: 'Amazon',          industry: 'ecommerce' },
  'ebay.com':            { brand: 'eBay',            industry: 'ecommerce' },
  'ebay.co.uk':          { brand: 'eBay',            industry: 'ecommerce' },
  'ebay.com.au':         { brand: 'eBay',            industry: 'ecommerce' },
  'flipkart.com':        { brand: 'Flipkart',        industry: 'ecommerce' },
  'myntra.com':          { brand: 'Myntra',          industry: 'ecommerce' },
  'meesho.com':          { brand: 'Meesho',          industry: 'ecommerce' },
  'ajio.com':            { brand: 'AJIO',            industry: 'ecommerce' },
  'etsy.com':            { brand: 'Etsy',            industry: 'ecommerce' },
  'aliexpress.com':      { brand: 'AliExpress',      industry: 'ecommerce' },
  'walmart.com':         { brand: 'Walmart',         industry: 'ecommerce' },
  'target.com':          { brand: 'Target',          industry: 'ecommerce' },
  'costco.com':          { brand: 'Costco',          industry: 'ecommerce' },
  'bestbuy.com':         { brand: 'Best Buy',        industry: 'ecommerce' },
  'newegg.com':          { brand: 'Newegg',          industry: 'ecommerce' },
  // ── Finance ─────────────────────────────────────────────────────────────
  'paypal.com':          { brand: 'PayPal',          industry: 'finance' },
  'stripe.com':          { brand: 'Stripe',          industry: 'finance' },
  'wise.com':            { brand: 'Wise',            industry: 'finance' },
  'revolut.com':         { brand: 'Revolut',         industry: 'finance' },
  'square.com':          { brand: 'Square',          industry: 'finance' },
  'venmo.com':           { brand: 'Venmo',           industry: 'finance' },
  'cashapp.com':         { brand: 'Cash App',        industry: 'finance' },
  'robinhood.com':       { brand: 'Robinhood',       industry: 'finance' },
  'zerodha.com':         { brand: 'Zerodha',         industry: 'finance' },
  'groww.in':            { brand: 'Groww',           industry: 'finance' },
  // ── Crypto ──────────────────────────────────────────────────────────────
  'coinbase.com':        { brand: 'Coinbase',        industry: 'crypto' },
  'binance.com':         { brand: 'Binance',         industry: 'crypto' },
  'kraken.com':          { brand: 'Kraken',          industry: 'crypto' },
  'crypto.com':          { brand: 'Crypto.com',      industry: 'crypto' },
  'blockchain.com':      { brand: 'Blockchain.com',  industry: 'crypto' },
  'bitfinex.com':        { brand: 'Bitfinex',        industry: 'crypto' },
  'metamask.io':         { brand: 'MetaMask',        industry: 'crypto' },
  // ── Banking – Indian ────────────────────────────────────────────────────
  'onlinesbi.sbi':       { brand: 'SBI',             industry: 'banking' },
  'sbi.co.in':           { brand: 'SBI',             industry: 'banking' },
  'hdfcbank.com':        { brand: 'HDFC',            industry: 'banking' },
  'icicibank.com':       { brand: 'ICICI',           industry: 'banking' },
  'axisbank.com':        { brand: 'Axis Bank',       industry: 'banking' },
  'kotak.com':           { brand: 'Kotak',           industry: 'banking' },
  'canarabank.com':      { brand: 'Canara Bank',     industry: 'banking' },
  'bankofbaroda.in':     { brand: 'Bank of Baroda',  industry: 'banking' },
  'bankofbaroda.com':    { brand: 'Bank of Baroda',  industry: 'banking' },
  'pnbindia.in':         { brand: 'PNB',             industry: 'banking' },
  'unionbankofindia.co.in': { brand: 'Union Bank',  industry: 'banking' },
  'idfcfirstbank.com':   { brand: 'IDFC First Bank', industry: 'banking' },
  'federalbank.co.in':   { brand: 'Federal Bank',   industry: 'banking' },
  'indianbank.in':       { brand: 'Indian Bank',     industry: 'banking' },
  'paytm.com':           { brand: 'Paytm',           industry: 'banking' },
  'phonepe.com':         { brand: 'PhonePe',         industry: 'banking' },
  'npci.org.in':         { brand: 'NPCI/UPI',        industry: 'banking' },
  'bhimupi.org.in':      { brand: 'BHIM UPI',        industry: 'banking' },
  // ── Banking – International ──────────────────────────────────────────────
  'hsbc.co.in':          { brand: 'HSBC',            industry: 'banking' },
  'hsbc.com':            { brand: 'HSBC',            industry: 'banking' },
  'barclays.co.uk':      { brand: 'Barclays',        industry: 'banking' },
  'barclays.com':        { brand: 'Barclays',        industry: 'banking' },
  'chase.com':           { brand: 'Chase',           industry: 'banking' },
  'bankofamerica.com':   { brand: 'Bank of America', industry: 'banking' },
  'citibank.com':        { brand: 'Citibank',        industry: 'banking' },
  'citi.com':            { brand: 'Citibank',        industry: 'banking' },
  'wellsfargo.com':      { brand: 'Wells Fargo',     industry: 'banking' },
  'usbank.com':          { brand: 'US Bank',         industry: 'banking' },
  'capitalone.com':      { brand: 'Capital One',     industry: 'banking' },
  'lloydsbank.com':      { brand: 'Lloyds Bank',     industry: 'banking' },
  'natwest.com':         { brand: 'NatWest',         industry: 'banking' },
  'rbs.co.uk':           { brand: 'RBS',             industry: 'banking' },
  'halifax.co.uk':       { brand: 'Halifax',         industry: 'banking' },
  'ing.com':             { brand: 'ING',             industry: 'banking' },
  'bnpparibas.com':      { brand: 'BNP Paribas',     industry: 'banking' },
  'commbank.com.au':     { brand: 'CommBank',        industry: 'banking' },
  'nab.com.au':          { brand: 'NAB',             industry: 'banking' },
  'anz.com.au':          { brand: 'ANZ',             industry: 'banking' },
  'westpac.com.au':      { brand: 'Westpac',         industry: 'banking' },
  // ── Entertainment ───────────────────────────────────────────────────────
  'netflix.com':         { brand: 'Netflix',         industry: 'entertainment' },
  'spotify.com':         { brand: 'Spotify',         industry: 'entertainment' },
  'youtube.com':         { brand: 'YouTube',         industry: 'entertainment' },
  'disneyplus.com':      { brand: 'Disney+',         industry: 'entertainment' },
  'disney.com':          { brand: 'Disney',          industry: 'entertainment' },
  'hulu.com':            { brand: 'Hulu',            industry: 'entertainment' },
  'primevideo.com':      { brand: 'Prime Video',     industry: 'entertainment' },
  'hbomax.com':          { brand: 'HBO Max',         industry: 'entertainment' },
  'max.com':             { brand: 'Max',             industry: 'entertainment' },
  'appletv.apple.com':   { brand: 'Apple TV+',       industry: 'entertainment' },
  'soundcloud.com':      { brand: 'SoundCloud',      industry: 'entertainment' },
  'deezer.com':          { brand: 'Deezer',          industry: 'entertainment' },
  'hotstar.com':         { brand: 'Hotstar',         industry: 'entertainment' },
  'jiocinema.com':       { brand: 'JioCinema',       industry: 'entertainment' },
  // ── Productivity / SaaS ─────────────────────────────────────────────────
  'zoom.us':             { brand: 'Zoom',            industry: 'productivity' },
  'slack.com':           { brand: 'Slack',           industry: 'productivity' },
  'notion.so':           { brand: 'Notion',          industry: 'productivity' },
  'trello.com':          { brand: 'Trello',          industry: 'productivity' },
  'asana.com':           { brand: 'Asana',           industry: 'productivity' },
  'monday.com':          { brand: 'Monday.com',      industry: 'productivity' },
  'dropbox.com':         { brand: 'Dropbox',         industry: 'productivity' },
  'box.com':             { brand: 'Box',             industry: 'productivity' },
  'evernote.com':        { brand: 'Evernote',        industry: 'productivity' },
  'todoist.com':         { brand: 'Todoist',         industry: 'productivity' },
  'airtable.com':        { brand: 'Airtable',        industry: 'productivity' },
  'clickup.com':         { brand: 'ClickUp',         industry: 'productivity' },
  'basecamp.com':        { brand: 'Basecamp',        industry: 'productivity' },
  'miro.com':            { brand: 'Miro',            industry: 'productivity' },
  'webex.com':           { brand: 'Webex',           industry: 'productivity' },
  'teams.microsoft.com': { brand: 'Microsoft Teams', industry: 'productivity' },
  'meet.google.com':     { brand: 'Google Meet',     industry: 'productivity' },
  // ── News / Media ────────────────────────────────────────────────────────
  'bbc.com':             { brand: 'BBC',             industry: 'news' },
  'bbc.co.uk':           { brand: 'BBC',             industry: 'news' },
  'cnn.com':             { brand: 'CNN',             industry: 'news' },
  'reuters.com':         { brand: 'Reuters',         industry: 'news' },
  'nytimes.com':         { brand: 'New York Times',  industry: 'news' },
  'theguardian.com':     { brand: 'The Guardian',    industry: 'news' },
  'forbes.com':          { brand: 'Forbes',          industry: 'news' },
  'bloomberg.com':       { brand: 'Bloomberg',       industry: 'news' },
  'wsj.com':             { brand: 'WSJ',             industry: 'news' },
  'washingtonpost.com':  { brand: 'Washington Post', industry: 'news' },
  'indiatimes.com':      { brand: 'Times of India',  industry: 'news' },
  'ndtv.com':            { brand: 'NDTV',            industry: 'news' },
  'thehindu.com':        { brand: 'The Hindu',       industry: 'news' },
  'hindustantimes.com':  { brand: 'Hindustan Times', industry: 'news' },
  // ── Travel ──────────────────────────────────────────────────────────────
  'booking.com':         { brand: 'Booking.com',     industry: 'travel' },
  'airbnb.com':          { brand: 'Airbnb',          industry: 'travel' },
  'makemytrip.com':      { brand: 'MakeMyTrip',      industry: 'travel' },
  'irctc.co.in':         { brand: 'IRCTC',           industry: 'travel' },
  'tripadvisor.com':     { brand: 'TripAdvisor',     industry: 'travel' },
  'expedia.com':         { brand: 'Expedia',         industry: 'travel' },
  'goibibo.com':         { brand: 'Goibibo',         industry: 'travel' },
  'cleartrip.com':       { brand: 'Cleartrip',       industry: 'travel' },
  'kayak.com':           { brand: 'Kayak',           industry: 'travel' },
  // ── Healthcare ──────────────────────────────────────────────────────────
  'who.int':             { brand: 'WHO',             industry: 'healthcare' },
  'mayoclinic.org':      { brand: 'Mayo Clinic',     industry: 'healthcare' },
  'nhs.uk':              { brand: 'NHS',             industry: 'healthcare' },
  'webmd.com':           { brand: 'WebMD',           industry: 'healthcare' },
  'healthline.com':      { brand: 'Healthline',      industry: 'healthcare' },
  'medscape.com':        { brand: 'Medscape',        industry: 'healthcare' },
  // ── Shipping ────────────────────────────────────────────────────────────
  'dhl.com':             { brand: 'DHL',             industry: 'shipping' },
  'fedex.com':           { brand: 'FedEx',           industry: 'shipping' },
  'ups.com':             { brand: 'UPS',             industry: 'shipping' },
  'usps.com':            { brand: 'USPS',            industry: 'shipping' },
  'royalmail.com':       { brand: 'Royal Mail',      industry: 'shipping' },
  'auspost.com.au':      { brand: 'Australia Post',  industry: 'shipping' },
  'indiapost.gov.in':    { brand: 'India Post',      industry: 'shipping' },
  'delhivery.com':       { brand: 'Delhivery',       industry: 'shipping' },
  // ── Telecom ─────────────────────────────────────────────────────────────
  'jio.com':             { brand: 'Jio',             industry: 'telecom' },
  'airtel.in':           { brand: 'Airtel',          industry: 'telecom' },
  'vodafone.com':        { brand: 'Vodafone',        industry: 'telecom' },
  'att.com':             { brand: 'AT&T',            industry: 'telecom' },
  'verizon.com':         { brand: 'Verizon',         industry: 'telecom' },
  't-mobile.com':        { brand: 'T-Mobile',        industry: 'telecom' },
  'bsnl.co.in':          { brand: 'BSNL',            industry: 'telecom' },
  // ── Government – India ──────────────────────────────────────────────────
  'uidai.gov.in':          { brand: 'UIDAI (Aadhaar)', industry: 'government' },
  'incometax.gov.in':      { brand: 'Income Tax India',industry: 'government' },
  'passportindia.gov.in':  { brand: 'Passport India',  industry: 'government' },
  'digilocker.gov.in':     { brand: 'DigiLocker',      industry: 'government' },
  'gst.gov.in':            { brand: 'GST India',        industry: 'government' },
  'mygov.in':              { brand: 'MyGov',            industry: 'government' },
  'india.gov.in':          { brand: 'India Portal',     industry: 'government' },
  'mca.gov.in':            { brand: 'MCA India',        industry: 'government' },
  'epfindia.gov.in':       { brand: 'EPFO',             industry: 'government' },
  'irda.gov.in':           { brand: 'IRDAI',            industry: 'government' },
  // ── Government – International ──────────────────────────────────────────
  'irs.gov':             { brand: 'IRS',             industry: 'government' },
  'gov.uk':              { brand: 'GOV.UK',          industry: 'government' },
  'usa.gov':             { brand: 'USA.gov',         industry: 'government' },
  'australia.gov.au':    { brand: 'Australia Gov',   industry: 'government' },
  // ── Education – Global ───────────────────────────────────────────────────
  'mit.edu':             { brand: 'MIT',             industry: 'education' },
  'stanford.edu':        { brand: 'Stanford',        industry: 'education' },
  'harvard.edu':         { brand: 'Harvard',         industry: 'education' },
  'ox.ac.uk':            { brand: 'Oxford',          industry: 'education' },
  'cam.ac.uk':           { brand: 'Cambridge',       industry: 'education' },
  // ── Education – IITs ─────────────────────────────────────────────────────
  'iitb.ac.in':          { brand: 'IIT Bombay',      industry: 'education' },
  'iitd.ac.in':          { brand: 'IIT Delhi',       industry: 'education' },
  'iitm.ac.in':          { brand: 'IIT Madras',      industry: 'education' },
  'iitk.ac.in':          { brand: 'IIT Kanpur',      industry: 'education' },
  'iitr.ac.in':          { brand: 'IIT Roorkee',     industry: 'education' },
  'iitkgp.ac.in':        { brand: 'IIT Kharagpur',   industry: 'education' },
  // ── Online Education ─────────────────────────────────────────────────────
  'coursera.org':        { brand: 'Coursera',        industry: 'education' },
  'edx.org':             { brand: 'edX',             industry: 'education' },
  'khanacademy.org':     { brand: 'Khan Academy',    industry: 'education' },
  'udemy.com':           { brand: 'Udemy',           industry: 'education' },
  'skillshare.com':      { brand: 'Skillshare',      industry: 'education' },
  'pluralsight.com':     { brand: 'Pluralsight',     industry: 'education' },
  'udacity.com':         { brand: 'Udacity',         industry: 'education' },
  // ── Search / Info ────────────────────────────────────────────────────────
  'wikipedia.org':       { brand: 'Wikipedia',       industry: 'information' },
  'wikimedia.org':       { brand: 'Wikimedia',       industry: 'information' },
  'bing.com':            { brand: 'Bing',            industry: 'technology' },
  'duckduckgo.com':      { brand: 'DuckDuckGo',      industry: 'technology' },
};

// ── TLD-based industry heuristics ────────────────────────────────────────────
// Applied when the domain is not in the exact map.
const TLD_RULES: Array<{ pattern: RegExp; industry: string }> = [
  { pattern: /\.(gov|gov\.[a-z]{2}|gc\.ca)$/, industry: 'government' },
  { pattern: /\.gov\.[a-z]+$/, industry: 'government' },
  { pattern: /\.(edu|edu\.[a-z]{2})$/, industry: 'education' },
  { pattern: /\.ac\.[a-z]+$/, industry: 'education' },
  { pattern: /\.(mil|mil\.[a-z]{2})$/, industry: 'government' },
  { pattern: /\.nhs\.uk$/, industry: 'healthcare' },
  { pattern: /\.bank$/, industry: 'banking' },
];

// ── Domain keyword → industry fallback ───────────────────────────────────────
// Checked against the apex domain when no exact or TLD match.
const KEYWORD_RULES: Array<{ keywords: string[]; industry: string }> = [
  { keywords: ['bank', 'banking', 'banque', 'bancorp', 'credit', 'finance', 'financ', 'invest', 'saving', 'mortgage', 'loan', 'mutual', 'nbfc'], industry: 'banking' },
  { keywords: ['univ', 'university', 'college', 'school', 'academy', 'institute', 'campus', 'faculty'], industry: 'education' },
  { keywords: ['hospital', 'clinic', 'health', 'pharma', 'medical', 'medic', 'doctor', 'patient', 'dental', 'care'], industry: 'healthcare' },
  { keywords: ['shop', 'store', 'mart', 'market', 'buy', 'sell', 'deal', 'discount', 'price', 'cart', 'order'], industry: 'ecommerce' },
  { keywords: ['news', 'media', 'press', 'times', 'post', 'herald', 'journal', 'tribune', 'chronicle', 'daily', 'gazette'], industry: 'news' },
  { keywords: ['travel', 'hotel', 'resort', 'tour', 'flight', 'airline', 'booking', 'ticket', 'vacation', 'holiday', 'safari'], industry: 'travel' },
  { keywords: ['telecom', 'mobile', 'wireless', 'cellular', 'broadband', 'network', 'connect'], industry: 'telecom' },
  { keywords: ['insurance', 'insure', 'policy', 'premium', 'claim', 'assurance'], industry: 'insurance' },
  { keywords: ['pay', 'payment', 'wallet', 'money', 'transfer', 'remit', 'cash', 'forex'], industry: 'finance' },
  { keywords: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'nft', 'token', 'coin', 'exchange'], industry: 'crypto' },
  { keywords: ['stream', 'movie', 'film', 'music', 'video', 'tv', 'watch', 'listen', 'play', 'game', 'entertain'], industry: 'entertainment' },
  { keywords: ['cloud', 'server', 'hosting', 'host', 'vps', 'cdn', 'infra', 'devops', 'deploy'], industry: 'cloud' },
  { keywords: ['social', 'forum', 'community', 'chat', 'messenger', 'message', 'friend', 'follower'], industry: 'social_media' },
  { keywords: ['gov', 'govt', 'government', 'municipal', 'ministry', 'department', 'authority', 'council', 'parliament', 'official'], industry: 'government' },
  { keywords: ['mail', 'email', 'inbox', 'webmail', 'smtp', 'imap'], industry: 'email' },
  { keywords: ['ship', 'delivery', 'courier', 'parcel', 'freight', 'cargo', 'logistics', 'dispatch', 'track'], industry: 'shipping' },
  { keywords: ['software', 'tech', 'app', 'digital', 'code', 'dev', 'it', 'cyber', 'security', 'saas', 'platform', 'api'], industry: 'technology' },
];

// ── Phishing impersonation patterns ──────────────────────────────────────────
// Matched against the full phishing URL (domain + path).
const PHISH_PATTERNS: Array<{ pattern: RegExp; brand: string; industry: string }> = [
  { pattern: /amazon/i,                                 brand: 'Amazon',        industry: 'ecommerce' },
  { pattern: /paypal/i,                                 brand: 'PayPal',        industry: 'finance' },
  { pattern: /microsoft|msft|office365|onedrive|outlook/i, brand: 'Microsoft', industry: 'technology' },
  { pattern: /google|gmail|googl/i,                    brand: 'Google',         industry: 'technology' },
  { pattern: /apple|icloud|itunes|appleid/i,           brand: 'Apple',          industry: 'technology' },
  { pattern: /facebook|fb-|fb\.login/i,                brand: 'Facebook',       industry: 'social_media' },
  { pattern: /instagram|insta-/i,                      brand: 'Instagram',      industry: 'social_media' },
  { pattern: /netflix|netfl/i,                         brand: 'Netflix',        industry: 'entertainment' },
  { pattern: /spotify/i,                               brand: 'Spotify',        industry: 'entertainment' },
  { pattern: /linkedin/i,                              brand: 'LinkedIn',       industry: 'social_media' },
  { pattern: /dropbox/i,                               brand: 'Dropbox',        industry: 'productivity' },
  { pattern: /adobe/i,                                 brand: 'Adobe',          industry: 'technology' },
  { pattern: /ebay/i,                                  brand: 'eBay',           industry: 'ecommerce' },
  { pattern: /walmart/i,                               brand: 'Walmart',        industry: 'ecommerce' },
  { pattern: /twitter|x\.com/i,                        brand: 'X (Twitter)',    industry: 'social_media' },
  { pattern: /discord/i,                               brand: 'Discord',        industry: 'social_media' },
  { pattern: /telegram/i,                              brand: 'Telegram',       industry: 'social_media' },
  { pattern: /whatsapp/i,                              brand: 'WhatsApp',       industry: 'social_media' },
  { pattern: /coinbase|binance|kraken|crypto/i,        brand: 'Crypto Exchange',industry: 'crypto' },
  { pattern: /bitcoin|ethereum|wallet|defi|nft/i,      brand: 'Crypto Wallet', industry: 'crypto' },
  { pattern: /dhl|fedex|ups|usps|royalmail|parcel|courier|track.*pack|pack.*track/i, brand: 'Shipping', industry: 'shipping' },
  { pattern: /irs|hmrc|tax|refund.*gov|gov.*refund/i,  brand: 'Tax Authority', industry: 'government' },
  { pattern: /aadhaar|uidai|aadhar/i,                  brand: 'UIDAI (Aadhaar)',industry: 'government' },
  { pattern: /sbi|onlinesbi/i,                         brand: 'SBI',            industry: 'banking' },
  { pattern: /hdfc|hdfcbank/i,                         brand: 'HDFC',           industry: 'banking' },
  { pattern: /icici|iciciban/i,                        brand: 'ICICI',          industry: 'banking' },
  { pattern: /axisbank|axis.*bank/i,                   brand: 'Axis Bank',      industry: 'banking' },
  { pattern: /kotak/i,                                 brand: 'Kotak',          industry: 'banking' },
  { pattern: /paytm|phonepe|upi|bhim/i,                brand: 'UPI/Wallet',     industry: 'banking' },
  { pattern: /chase|wellsfargo|bankofamerica|citibank|barclays|natwest|lloyds/i, brand: 'Western Bank', industry: 'banking' },
  { pattern: /bank|banking/i,                          brand: 'Generic Bank',   industry: 'banking' },
  { pattern: /visa|mastercard|amex|credit.*card/i,     brand: 'Payment Card',   industry: 'finance' },
  { pattern: /irctc|railw/i,                           brand: 'IRCTC',          industry: 'travel' },
  { pattern: /booking|airbnb|hotel|resort/i,           brand: 'Travel Portal',  industry: 'travel' },
];

// ── Public helper ─────────────────────────────────────────────────────────────

/**
 * Classify a URL into brand, industry, impersonatedBrand, and isKnownBrand.
 *
 * @param apexDomain  e.g. "hdfcbank.com" (no scheme, no subdomains)
 * @param tld         from CSV column, e.g. "co.in"
 * @param fullUrl     full original URL (used for phishing pattern matching)
 * @param label       0 = legitimate, 1 = phishing
 */
export function classify(
  apexDomain: string,
  tld: string,
  fullUrl: string,
  label: 0 | 1,
): ClassificationResult {
  // 1. Exact domain lookup (most reliable)
  const exactMatch = DOMAIN_MAP[apexDomain];
  if (exactMatch) {
    return {
      brand: exactMatch.brand,
      industry: exactMatch.industry,
      impersonatedBrand: label === 1 ? detectPhishBrand(fullUrl) : '',
      isKnownBrand: true,
    };
  }

  // 2. For phishing, detect impersonated brand and derive industry from that
  if (label === 1) {
    const phishBrand = detectPhishBrand(fullUrl);
    const phishEntry = PHISH_PATTERNS.find((p) => p.brand === phishBrand);
    return {
      brand: `${phishBrand} (phishing)`,
      industry: phishEntry?.industry ?? 'other',
      impersonatedBrand: phishBrand,
      isKnownBrand: false,
    };
  }

  // 3. TLD heuristic (e.g. .gov.in → government, .edu → education)
  const domainForTld = `.${tld}`;
  for (const rule of TLD_RULES) {
    if (rule.pattern.test(domainForTld)) {
      return {
        brand: apexDomain,
        industry: rule.industry,
        impersonatedBrand: '',
        isKnownBrand: false,
      };
    }
  }

  // 4. Domain keyword fallback
  const domainLower = apexDomain.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => domainLower.includes(kw))) {
      return {
        brand: apexDomain,
        industry: rule.industry,
        impersonatedBrand: '',
        isKnownBrand: false,
      };
    }
  }

  return {
    brand: apexDomain,
    industry: 'other',
    impersonatedBrand: '',
    isKnownBrand: false,
  };
}

/** Detect which brand a phishing URL is impersonating. Returns 'Unknown' if none matched. */
function detectPhishBrand(fullUrl: string): string {
  const haystack = fullUrl.toLowerCase();
  for (const { pattern, brand } of PHISH_PATTERNS) {
    if (pattern.test(haystack)) return brand;
  }
  return 'Unknown';
}

/** Extract apex domain from the CSV's `dom` field and `tld` field. */
export function extractApexDomain(dom: string, tld: string): string {
  if (!dom) return '';
  const tldParts = tld.split('.').length;
  const domParts = dom.split('.');
  // Apex = eTLD+1 labels (tld parts + 1 more)
  const take = tldParts + 1;
  if (domParts.length <= take) return dom;
  return domParts.slice(-take).join('.');
}

/** Set of known high-priority brand apex domains (always force-included). */
export const PRIORITY_BRANDS = new Set<string>([
  'google.com', 'microsoft.com', 'apple.com', 'amazon.com', 'amazon.in',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'reddit.com', 'discord.com', 'youtube.com', 'netflix.com', 'spotify.com',
  'github.com', 'gitlab.com', 'stackoverflow.com', 'adobe.com',
  'paypal.com', 'stripe.com', 'coinbase.com', 'binance.com',
  'hdfcbank.com', 'icicibank.com', 'sbi.co.in', 'onlinesbi.sbi',
  'axisbank.com', 'kotak.com', 'bankofamerica.com', 'chase.com',
  'uidai.gov.in', 'incometax.gov.in', 'digilocker.gov.in',
  'mit.edu', 'stanford.edu', 'harvard.edu', 'iitb.ac.in', 'iitd.ac.in',
  'who.int', 'nhs.uk', 'booking.com', 'airbnb.com', 'irctc.co.in',
  'cloudflare.com', 'digitalocean.com', 'dropbox.com', 'zoom.us',
  'slack.com', 'notion.so', 'flipkart.com',
]);
