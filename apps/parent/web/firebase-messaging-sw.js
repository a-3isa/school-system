// Shows push notifications while the parent app's web page is closed or in the
// background. Firebase's own script displays the notification the server sent
// (already in the language of the app); this file only has to start it.
// The values below are public identifiers of the "School Parent (Web)" app in
// the school-platform-eg Firebase project, the same as in lib/firebase_options.dart.
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD_ss-qpOg8xiKFOc6MPVzKWohuYuyiya0',
  authDomain: 'school-platform-eg.firebaseapp.com',
  projectId: 'school-platform-eg',
  storageBucket: 'school-platform-eg.firebasestorage.app',
  messagingSenderId: '23760286035',
  appId: '1:23760286035:web:c5e0e0d8e4259858acb1a6',
});

firebase.messaging();
