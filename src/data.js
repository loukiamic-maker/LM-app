// Example listings for the interactive prototype; these are not real businesses.
export const categories = [
  { id: 'all', label: 'Όλα', shortLabel: 'Όλα', icon: 'sparkles', photoIndex: 0 },
  { id: 'hair', label: 'Κομμωτήρια', shortLabel: 'Μαλλιά', icon: 'scissors', photoIndex: 0 },
  { id: 'nails', label: 'Νύχια', shortLabel: 'Νύχια', icon: 'hand', photoIndex: 1 },
  { id: 'face', label: 'Περιποίηση προσώπου', shortLabel: 'Πρόσωπο', icon: 'flower', photoIndex: 2 },
  { id: 'massage', label: 'Μασάζ & spa', shortLabel: 'Μασάζ', icon: 'leaf', photoIndex: 3 },
  { id: 'makeup', label: 'Μακιγιάζ', shortLabel: 'Μακιγιάζ', icon: 'sparkles', photoIndex: 4 },
  { id: 'laser', label: 'Αποτρίχωση με λέιζερ', shortLabel: 'Λέιζερ', icon: 'sun', photoIndex: 6 },
  { id: 'brows', label: 'Φρύδια & βλεφαρίδες', shortLabel: 'Φρύδια', icon: 'eye', photoIndex: 7 },
  { id: 'barber', label: 'Κουρεία', shortLabel: 'Κουρείο', icon: 'scissors', photoIndex: 5 },
];

export const locationGroups = [
  { country: 'Κύπρος', cities: ['Λάρνακα', 'Λευκωσία', 'Λεμεσός', 'Πάφος', 'Παραλίμνι'] },
  { country: 'Ελλάδα', cities: ['Αθήνα', 'Θεσσαλονίκη'] },
];

export const salons = [
  {
    id: 'atelier-hair', name: 'Atelier Hair Studio', category: 'hair',
    location: 'Κολωνάκι, Αθήνα', city: 'Αθήνα', country: 'Ελλάδα',
    rating: 4.9, reviewCount: 128, image: '/images/beauty-grid.png', photoIndex: 8,
    tag: 'Αγαπημένο της κοινότητας',
    description: 'Ένας φωτεινός χώρος στην καρδιά του Κολωνακίου, αφιερωμένος στα όμορφα μαλλιά. Προσωπική φροντίδα, φυσικές αποχρώσεις και ένα κούρεμα που σας ταιριάζει',
    services: [
      { name: 'Κούρεμα & χτένισμα', duration: 60, price: 35 },
      { name: 'Λούσιμο & χτένισμα', duration: 40, price: 25 },
      { name: 'Balayage & χτένισμα', duration: 150, price: 95 },
    ],
    availability: ['09:00', '10:30', '13:00', '15:30', '17:00'], isDemo: true,
  },
  {
    id: 'sharp-barber', name: 'The Gentlemen’s Club', category: 'barber',
    location: 'Γλυφάδα, Αθήνα', city: 'Αθήνα', country: 'Ελλάδα',
    rating: 4.9, reviewCount: 96, image: '/images/beauty-grid.png', photoIndex: 9,
    tag: 'Κλασική τέχνη, σύγχρονο στυλ',
    description: 'Προσεγμένα κουρέματα και παραδοσιακή περιποίηση γενειάδας σε μια χαλαρή γωνιά της Γλυφάδας. Μια μικρή ιεροτελεστία φροντίδας με χαρακτήρα',
    services: [
      { name: 'Ανδρικό κούρεμα', duration: 30, price: 25 },
      { name: 'Κούρεμα & περιποίηση γενειάδας', duration: 45, price: 32 },
      { name: 'Παραδοσιακό ξύρισμα', duration: 30, price: 20 },
    ],
    availability: ['10:00', '11:30', '14:00', '16:00'], isDemo: true,
  },
  {
    id: 'bare-nail', name: 'Bare Nail Atelier', category: 'nails',
    location: 'Έγκωμη, Λευκωσία', city: 'Λευκωσία', country: 'Κύπρος',
    rating: 4.8, reviewCount: 84, image: '/images/beauty-grid.png', photoIndex: 10,
    tag: 'Μικρές λεπτομέρειες, μεγάλη διαφορά',
    description: 'Περιποιημένα άκρα, ήρεμη ατμόσφαιρα και αποχρώσεις για κάθε διάθεση. Μια μικρή στάση αυτοφροντίδας στην Έγκωμη, μέσα στη μέρα σας',
    services: [
      { name: 'Ημιμόνιμο μανικιούρ', duration: 45, price: 25 },
      { name: 'Κλασικό μανικιούρ', duration: 30, price: 20 },
      { name: 'Πεντικιούρ περιποίησης', duration: 50, price: 35 },
    ],
    availability: ['09:30', '12:00', '14:30', '17:30'], isDemo: true,
  },
  {
    id: 'glow-skin', name: 'Glow Skin Studio', category: 'face',
    location: 'Κέντρο, Θεσσαλονίκη', city: 'Θεσσαλονίκη', country: 'Ελλάδα',
    rating: 4.9, reviewCount: 63, image: '/images/beauty-grid.png', photoIndex: 8,
    tag: 'Φροντίδα που φαίνεται',
    description: 'Εξατομικευμένη φροντίδα για μια πιο φωτεινή και ξεκούραστη επιδερμίδα. Ανακαλύψτε τη θεραπεία που ανταποκρίνεται στις ανάγκες σας, στο κέντρο της Θεσσαλονίκης',
    services: [
      { name: 'Ενυδατική θεραπεία προσώπου', duration: 60, price: 50 },
      { name: 'Βαθύς καθαρισμός προσώπου', duration: 75, price: 65 },
      { name: 'Μασάζ προσώπου', duration: 30, price: 30 },
    ],
    availability: ['10:00', '12:30', '15:00', '16:30'], isDemo: true,
  },
  {
    id: 'arch-brow', name: 'Arch Brow & Lash', category: 'brows',
    location: 'Νεάπολη, Λεμεσός', city: 'Λεμεσός', country: 'Κύπρος',
    rating: 4.8, reviewCount: 72, image: '/images/beauty-grid.png', photoIndex: 10,
    tag: 'Το βλέμμα σας, στα καλύτερά του',
    description: 'Φυσικό αποτέλεσμα και προσοχή σε κάθε λεπτομέρεια. Σχηματισμός φρυδιών και περιποίηση βλεφαρίδων που αναδεικνύουν το βλέμμα σας, σε έναν φιλόξενο χώρο στη Λεμεσό',
    services: [
      { name: 'Σχηματισμός φρυδιών', duration: 20, price: 15 },
      { name: 'Lash lift', duration: 60, price: 45 },
      { name: 'Brow lamination', duration: 45, price: 35 },
    ],
    availability: ['09:00', '11:00', '13:30', '15:00', '17:00'], isDemo: true,
  },
  {
    id: 'still-wellness', name: 'Still Wellness House', category: 'massage',
    location: 'Σκάλα, Λάρνακα', city: 'Λάρνακα', country: 'Κύπρος',
    rating: 4.7, reviewCount: 58, image: '/images/beauty-grid.png', photoIndex: 9,
    tag: 'Η δική σας στιγμή ηρεμίας',
    description: 'Αφήστε την ένταση έξω από την πόρτα. Απαλά αρώματα, ζεστός φωτισμός και θεραπείες που προσφέρουν στο σώμα την ξεκούραση που χρειάζεται, κοντά στη θάλασσα της Λάρνακας',
    services: [
      { name: 'Χαλαρωτικό μασάζ', duration: 60, price: 60 },
      { name: 'Μασάζ πλάτης & αυχένα', duration: 30, price: 35 },
      { name: 'Μασάζ με ζεστές πέτρες', duration: 75, price: 80 },
    ],
    availability: ['09:30', '11:30', '14:00', '16:00'], isDemo: true,
  },
  {
    id: 'aura-makeup', name: 'Aura Makeup Atelier', category: 'makeup',
    location: 'Κέντρο, Πάτρα', city: 'Πάτρα', country: 'Ελλάδα',
    rating: 4.9, reviewCount: 47, image: '/images/beauty-grid.png', photoIndex: 10,
    tag: 'Η πιο φωτεινή εκδοχή σας',
    description: 'Ανάλαφρες υφές, προσεγμένες αποχρώσεις και μακιγιάζ που αναδεικνύει τα χαρακτηριστικά σας. Από μια ξεχωριστή βραδιά μέχρι τη μέρα του γάμου σας, νιώστε όμορφα με τον δικό σας τρόπο',
    services: [
      { name: 'Βραδινό μακιγιάζ', duration: 60, price: 45 },
      { name: 'Φυσικό μακιγιάζ ημέρας', duration: 40, price: 30 },
      { name: 'Δοκιμαστικό νυφικού μακιγιάζ', duration: 90, price: 65 },
    ],
    availability: ['10:00', '12:00', '15:30', '17:00'], isDemo: true,
  },
  {
    id: 'skin-lab', name: 'Skin Lab Limassol', category: 'laser',
    location: 'Άγιος Νικόλαος, Λεμεσός', city: 'Λεμεσός', country: 'Κύπρος',
    rating: 4.8, reviewCount: 69, image: '/images/beauty-grid.png', photoIndex: 11,
    tag: 'Απαλή επιδερμίδα, προσωπική φροντίδα',
    description: 'Ένας σύγχρονος χώρος αφιερωμένος στην περιποίηση της επιδερμίδας. Ανακαλύψτε επιλογές αποτρίχωσης με λέιζερ και εξατομικευμένη αξιολόγηση πριν από την πρώτη σας συνεδρία',
    services: [
      { name: 'Λέιζερ μασχάλες', duration: 20, price: 25 },
      { name: 'Λέιζερ μπικίνι', duration: 30, price: 40 },
      { name: 'Λέιζερ ολόκληρα πόδια', duration: 50, price: 70 },
    ],
    availability: ['09:30', '11:00', '13:30', '16:30'], isDemo: true,
  },
];
