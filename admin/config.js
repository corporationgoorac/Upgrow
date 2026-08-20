// Import the functions you need from the SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAVo8P53-D548ZOg3urHhpOwDxx0Li0igc",
  authDomain: "up-grow.firebaseapp.com",
  projectId: "up-grow",
  storageBucket: "up-grow.firebasestorage.app",
  messagingSenderId: "1068537552495",
  appId: "1:1068537552495:web:b191d1cef51d6a7c83f79a",
  measurementId: "G-RBS53VS51F"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// Export the instances so they can be used across your entire PWA
export { app, analytics, auth, db };
