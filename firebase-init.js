// Import the functions you need from the SDKs you need
//import { initializeApp } from "firebase/app";
//import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA6rhXRd85AWhWKXQ0siwgsaCTQ8gzw65c",
  authDomain: "lizardwizard-623cf.firebaseapp.com",
  databaseURL: "https://lizardwizard-623cf-default-rtdb.firebaseio.com",
  projectId: "lizardwizard-623cf",
  storageBucket: "lizardwizard-623cf.firebasestorage.app",
  messagingSenderId: "863629888200",
  appId: "1:863629888200:web:36d10af81ca94159d1b3fd",
  measurementId: "G-NNZ1DPVG4B"
};

// Initialize Firebase (if not already initialized)
if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase initialized");
} else {
    console.log("Firebase already initialized");
}

// Make the Firebase app and database globally available
const db = firebase.database();
