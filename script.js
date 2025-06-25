// script.js

// Firebase imports - These need to be in the JS file when type="module" is used
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// DOM elements
const getAdviceBtn = document.getElementById('get-advice-btn');
const adviceDisplay = document.getElementById('advice-display');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const adviceImage = document.getElementById('advice-image');
const imageLoadingIndicator = document.getElementById('image-loading-indicator');
const imageErrorMessage = document.getElementById('image-error-message');
const prevAdviceBtn = document.getElementById('prev-advice-btn');
const nextAdviceBtn = document.getElementById('next-advice-btn');
const userIdDisplay = document.getElementById('user-id-display');
const messageBox = document.getElementById('message-box');

// Firebase variables
let app;
let auth;
let db;
let userId;
let adviceHistory = []; // Array to store fetched advice history
let currentHistoryIndex = -1; // Current index in the adviceHistory array

// Global Firebase config variables (initialized in initializeFirebase)
let appId;
let firebaseConfig;
let initialAuthToken;


/**
 * Displays a temporary message in the message box.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', 'warning'. Determines styling.
 */
const showMessage = (message, type = 'warning') => {
    messageBox.textContent = message;
    messageBox.classList.remove('hidden', 'bg-red-100', 'border-red-400', 'text-red-700', 'bg-green-100', 'border-green-400', 'text-green-700', 'bg-yellow-100', 'border-yellow-400', 'text-yellow-700');
    if (type === 'error') {
        messageBox.classList.add('bg-red-100', 'border-red-400', 'text-red-700');
    } else if (type === 'success') {
        messageBox.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
    } else { // warning or default
        messageBox.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-700');
    }
    messageBox.classList.remove('hidden');
    setTimeout(() => {
        messageBox.classList.add('hidden');
    }, 3000); // Hide after 3 seconds
};

/**
 * Initializes Firebase and authenticates the user.
 */
const initializeFirebase = async () => {
    try {
        // Assign values to global Firebase config variables from Canvas environment
        appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        if (Object.keys(firebaseConfig).length === 0) {
            throw new Error("Firebase configuration is missing.");
        }

        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Authenticate user
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                userIdDisplay.textContent = `User ID: ${userId}`;
                console.log("Firebase initialized and user authenticated:", userId);
                await fetchAdviceHistory(); // Fetch history after authentication
                if (adviceHistory.length > 0) {
                    currentHistoryIndex = adviceHistory.length - 1; // Show the latest advice
                    await displayAdvice(adviceHistory[currentHistoryIndex]); // Await this
                } else {
                    await fetchAdvice(); // Fetch new advice if no history, and await
                }
            } else {
                // Sign in anonymously if no token, or if token sign-in fails
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (anonError) {
                    console.error("Anonymous sign-in failed:", anonError);
                    showMessage("Authentication failed. Please check your network.", 'error');
                    userIdDisplay.textContent = "User ID: Failed to authenticate";
                }
            }
            updateNavigationButtons();
        });
    } catch (error) {
        console.error("Error initializing Firebase:", error);
        showMessage(`Failed to initialize application: ${error.message}`, 'error');
        userIdDisplay.textContent = "User ID: Initialization failed";
    }
};

/**
 * Fetches an image based on a given prompt using the Imagen 3.0 API.
 * Displays the image or an error message.
 * @param {string} prompt - The text prompt to generate the image.
 * @returns {Promise<string|null>} - The base64 image URL or null if generation fails.
 */
const generateImage = async (prompt) => {
    imageLoadingIndicator.classList.remove('hidden');
    imageErrorMessage.classList.add('hidden');
    adviceImage.src = ''; // Clear previous image
    adviceImage.classList.add('hidden'); // Hide image while loading/generating

    try {
        // Enhance the prompt for image generation to encourage suitable and balanced images.
        const imagePrompt = `A high-quality image, balanced composition, suitable illustration for the advice: "${prompt}". Focus on concepts rather than literal depiction for abstract advice.`;
        const payload = { instances: { prompt: imagePrompt }, parameters: { "sampleCount": 1} };
        const apiKey = ""; // Canvas will automatically provide the API key
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
            const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
            return imageUrl;
        } else {
            imageErrorMessage.textContent = "Could not generate a suitable image. Please try again.";
            imageErrorMessage.classList.remove('hidden');
            return null;
        }
    } catch (error) {
        console.error('Error generating image:', error);
        imageErrorMessage.textContent = "Error generating image. Please try again.";
        imageErrorMessage.classList.remove('hidden');
        return null;
    } finally {
        imageLoadingIndicator.classList.add('hidden');
    }
};

/**
 * Fetches a random advice from the Advice Slip API.
 * Displays the advice, generates and displays a corresponding image, and saves to history.
 */
const fetchAdvice = async () => {
    loadingIndicator.classList.remove('hidden');
    errorMessage.classList.add('hidden');
    adviceDisplay.textContent = '';
    adviceDisplay.classList.add('opacity-0');
    adviceImage.classList.add('hidden');
    imageErrorMessage.classList.add('hidden');

    try {
        const response = await fetch('https://api.adviceslip.com/advice');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.slip && data.slip.advice) {
            const adviceText = `"${data.slip.advice}"`;
            adviceDisplay.textContent = adviceText;

            // Generate image for immediate display, but don't save to Firestore
            const imageUrlForDisplay = await generateImage(data.slip.advice);

            // Save to Firestore only if userId is available and image generation was successful
            if (userId && db && appId) {
                const newAdviceEntry = {
                    advice: data.slip.advice,
                    // imageUrl is NOT saved to Firestore due to size limits
                    timestamp: Date.now()
                };
                try {
                    const adviceCollection = collection(db, `artifacts/${appId}/users/${userId}/advice_history`);
                    await addDoc(adviceCollection, newAdviceEntry);
                    console.log("Advice saved to Firestore (without image URL).");
                    // After saving, re-fetch history to update the current view
                    await fetchAdviceHistory();
                    currentHistoryIndex = adviceHistory.length - 1; // Move to the newly added item
                    // Display the newly added item (will re-generate image on demand)
                    await displayAdvice(adviceHistory[currentHistoryIndex]);
                    showMessage("New advice saved!", 'success');
                } catch (dbError) {
                    console.error("Error saving advice to Firestore:", dbError);
                    showMessage("Could not save advice to history.", 'error');
                }
            } else {
                // If not logged in or Firestore not ready, just display the current advice and image
                // The imageUrlForDisplay is valid only for the current session, not persisted.
                if (imageUrlForDisplay) {
                    adviceImage.src = imageUrlForDisplay;
                    adviceImage.classList.remove('hidden');
                } else {
                    adviceImage.classList.add('hidden');
                }
                showMessage("Not logged in. Advice not saved to history.", 'warning');
            }

        } else {
            adviceDisplay.textContent = "Could not retrieve advice. Invalid data format.";
        }
    } catch (error) {
        console.error('Error fetching advice:', error);
        errorMessage.textContent = `Could not connect to the server or API. Please check your internet connection.`;
        errorMessage.classList.remove('hidden');
        adviceDisplay.textContent = "Sorry, could not get advice at this time.";
        showMessage("Failed to fetch new advice.", 'error');
    } finally {
        loadingIndicator.classList.add('hidden');
        adviceDisplay.classList.remove('opacity-0');
    }
    updateNavigationButtons();
};

/**
 * Fetches advice history from Firestore.
 */
const fetchAdviceHistory = async () => {
    if (!db || !userId || !appId) {
        console.warn("Firestore, User ID, or App ID not available to fetch history.");
        return;
    }
    loadingIndicator.classList.remove('hidden');
    try {
        // Order by timestamp in ascending order to easily navigate forward/backward
        const q = query(collection(db, `artifacts/${appId}/users/${userId}/advice_history`), orderBy("timestamp"));
        const querySnapshot = await getDocs(q);
        adviceHistory = [];
        querySnapshot.forEach((doc) => {
            // Only advice and timestamp are stored; imageUrl is regenerated on demand
            adviceHistory.push({ id: doc.id, advice: doc.data().advice, timestamp: doc.data().timestamp });
        });
        console.log("Advice history fetched:", adviceHistory.length, "items.");
        showMessage(`Loaded ${adviceHistory.length} previous advices.`, 'success');

    } catch (error) {
        console.error("Error fetching advice history:", error);
        showMessage("Could not load advice history.", 'error');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
};

/**
 * Displays a specific advice entry.
 * This function now also triggers image generation if the imageUrl is not present
 * (which will be the case for historical items fetched from Firestore).
 * @param {object} entry - The advice entry object {advice, timestamp}.
 */
const displayAdvice = async (entry) => { // Made async to await image generation
    if (!entry) {
        adviceDisplay.textContent = "No advice to display.";
        adviceImage.classList.add('hidden');
        return;
    }
    adviceDisplay.textContent = `"${entry.advice}"`;
    adviceDisplay.classList.remove('opacity-0');

    // Always regenerate image for display, as it's not stored in history
    const generatedImageUrl = await generateImage(entry.advice);
    if (generatedImageUrl) {
        adviceImage.src = generatedImageUrl;
        adviceImage.classList.remove('hidden');
    } else {
        adviceImage.classList.add('hidden');
        imageErrorMessage.textContent = "Could not generate image for this advice.";
        imageErrorMessage.classList.remove('hidden');
    }
};

/**
 * Navigates to the previous advice in history.
 */
const showPreviousAdvice = async () => { // Made async
    if (currentHistoryIndex > 0) {
        currentHistoryIndex--;
        await displayAdvice(adviceHistory[currentHistoryIndex]); // Await displayAdvice
    }
    updateNavigationButtons();
};

/**
 * Navigates to the next advice in history.
 */
const showNextAdvice = async () => { // Made async
    if (currentHistoryIndex < adviceHistory.length - 1) {
        currentHistoryIndex++;
        await displayAdvice(adviceHistory[currentHistoryIndex]); // Await displayAdvice
    }
    updateNavigationButtons();
};

/**
 * Updates the state (enabled/disabled) of navigation buttons.
 */
const updateNavigationButtons = () => {
    prevAdviceBtn.disabled = currentHistoryIndex <= 0;
    prevAdviceBtn.classList.toggle('opacity-50', currentHistoryIndex <= 0);
    prevAdviceBtn.classList.toggle('cursor-not-allowed', currentHistoryIndex <= 0);

    nextAdviceBtn.disabled = currentHistoryIndex >= adviceHistory.length - 1;
    nextAdviceBtn.classList.toggle('opacity-50', currentHistoryIndex >= adviceHistory.length - 1);
    nextAdviceBtn.classList.toggle('cursor-not-allowed', currentHistoryIndex >= adviceHistory.length - 1);
};

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase(); // Initialize Firebase on page load
    getAdviceBtn.addEventListener('click', fetchAdvice);
    prevAdviceBtn.addEventListener('click', showPreviousAdvice);
    nextAdviceBtn.addEventListener('click', showNextAdvice);
});
