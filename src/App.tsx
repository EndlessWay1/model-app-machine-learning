import { useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";

import Camera from "./components/Camera";
import CamScannerFilter from "./components/CamscannerFilter";
import { resizeImage } from "./components/ImageResizer";
import { predictImage, type PredictionResult } from "./components/PredictImage";
import ImageCropper from "./components/ImageCropper";

import "./App.css";

type Step = 0 | 1 | 2 | 3;

const MODEL_CONFIGS = [
  { key: "cnn", label: "CNN", url: "/cnn_model_web/model.json" },
  {
    key: "efficient",
    label: "EfficientNet",
    url: "/efficient_model_web/model.json",
  },
] as const;

type ModelKey = (typeof MODEL_CONFIGS)[number]["key"];
type Models = Partial<Record<ModelKey, tf.GraphModel>>;
type Results = Partial<Record<ModelKey, PredictionResult[]>>;

const steps = [
  { title: "Capture", description: "Take or upload an image" },
  { title: "Enhance", description: "Crop and apply filters" },
  { title: "Resize", description: "Prepare image for AI" },
  { title: "Analyze", description: "Classify your image" },
];

function App() {
  const [models, setModels] = useState<Models>({});
  const [modelLoading, setModelLoading] = useState(true);
  const loadedCount = Object.keys(models).length;

  const [captured, setCaptured] = useState<Blob | null>(null);
  const [processed, setProcessed] = useState<Blob | null>(null);
  const [resized, setResized] = useState<Blob | null>(null);

  const [preview, setPreview] = useState("");
  const [processedPreview, setProcessedPreview] = useState("");
  const [resizedPreview, setResizedPreview] = useState("");

  const [classNames, setClassNames] = useState<string[]>([]);
  const [showCropper, setShowCropper] = useState(false);

  const [step, setStep] = useState<Step>(0);

  const [results, setResults] = useState<Results | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [resizing, setResizing] = useState(false);

  // Load class names
  useEffect(() => {
    let active = true;

    async function loadClasses() {
      try {
        const response = await fetch("/class_names.txt");

        if (!response.ok) {
          throw new Error("Failed to load class names.");
        }

        const text = await response.text();

        if (active) {
          setClassNames(
            text
              .split(/\r?\n/)
              .map((name) => name.trim())
              .filter(Boolean),
          );
        }
      } catch (error) {
        console.error("Class loading error:", error);
      }
    }

    loadClasses();

    return () => {
      active = false;
    };
  }, []);

  // Load TensorFlow models
  useEffect(() => {
    let mounted = true;
    const loaded: tf.GraphModel[] = [];

    async function loadModels() {
      await tf.ready();

      await Promise.all(
        MODEL_CONFIGS.map(async ({ key, url, label }) => {
          try {
            const m = await tf.loadGraphModel(url);

            if (!mounted) {
              m.dispose();
              return;
            }

            loaded.push(m);
            setModels((prev) => ({ ...prev, [key]: m }));
            console.log(`${label} loaded`, m.inputs, m.outputs);
          } catch (error) {
            console.error(`Failed to load ${label}:`, error);
          }
        }),
      );

      if (mounted) setModelLoading(false);
    }

    loadModels();

    return () => {
      mounted = false;
      loaded.forEach((m) => m.dispose());
    };
  }, []);

  // Captured image preview
  useEffect(() => {
    if (!captured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(captured);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [captured]);

  // Processed image preview
  useEffect(() => {
    if (!processed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProcessedPreview("");
      return;
    }

    const url = URL.createObjectURL(processed);
    setProcessedPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [processed]);

  // Resized image preview
  useEffect(() => {
    if (!resized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResizedPreview("");
      return;
    }

    const url = URL.createObjectURL(resized);
    setResizedPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [resized]);

  // Reset downstream processing when a new image is captured
  function handleCapture(blob: Blob) {
    setCaptured(blob);
    setProcessed(null);
    setResized(null);
    setResults(null);
    setShowCropper(false);
    setStep(0);
  }

  // Crop image
  function handleCrop(blob: Blob) {
    setCaptured(blob);
    setProcessed(null);
    setResized(null);
    setResults(null);
    setShowCropper(false);
  }

  // Apply image processing
  function handleApplyFilter(blob: Blob) {
    setProcessed(blob);
    setResized(null);
    setResults(null);
  }

  // Resize image
  async function handleResize() {
    if (!processed || resizing) return;

    setResizing(true);

    try {
      const resizedBlob = await resizeImage(processed, {
        width: 224,
        height: 224,
        fit: "contain",
        format: "image/jpeg",
      });

      setResized(resizedBlob);
      setResults(null);
    } catch (error) {
      console.error("Resize failed:", error);
    } finally {
      setResizing(false);
    }
  }

  // Run prediction on all loaded models
  async function handlePredict() {
    if (
      loadedCount === 0 ||
      !resized ||
      classNames.length !== 49 ||
      predicting
    ) {
      return;
    }

    setPredicting(true);
    setResults(null);

    let bitmap: ImageBitmap | null = null;

    try {
      bitmap = await createImageBitmap(resized);

      const canvas = document.createElement("canvas");
      canvas.width = 224;
      canvas.height = 224;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create canvas context.");

      ctx.drawImage(bitmap, 0, 0, 224, 224);

      const output: Results = {};

      // Sequential to keep GPU/WebGL memory usage low
      for (const { key, label } of MODEL_CONFIGS) {
        const m = models[key];
        if (!m) continue;

        try {
          output[key] = await predictImage(m, canvas, classNames);
        } catch (error) {
          console.error(`${label} prediction error:`, error);
        }
      }

      setResults(output);
    } catch (error) {
      console.error("Prediction error:", error);
    } finally {
      bitmap?.close();
      setPredicting(false);
    }
  }

  // Determine if the current step is completed
  const canContinue = [
    Boolean(captured),
    Boolean(processed),
    Boolean(resized),
    Boolean(results),
  ][step];

  function nextStep() {
    if (!canContinue || step === 3) return;

    setStep((current) => (current + 1) as Step);
  }

  function previousStep() {
    if (step === 0) return;

    setStep((current) => (current - 1) as Step);
  }

  function restart() {
    setCaptured(null);
    setProcessed(null);
    setResized(null);
    setResults(null);
    setShowCropper(false);
    setStep(0);
  }

  return (
    <main className='scanner-app'>
      <header className='app-header'>
        <div className='brand'>
          <div className='brand-icon'>✦</div>
          <span>
            Vision<span className='brand-accent'>AI</span>
          </span>
        </div>

        <div className='model-status'>
          <span className={`status-dot ${loadedCount > 0 ? "online" : ""}`} />
          {modelLoading
            ? "Loading AI models..."
            : loadedCount === MODEL_CONFIGS.length
              ? "AI Models Ready"
              : loadedCount > 0
                ? `${loadedCount}/${MODEL_CONFIGS.length} Models Ready`
                : "Models Unavailable"}
        </div>
      </header>

      <section className='wizard-container'>
        <div className='wizard-heading'>
          <span className='eyebrow'>IMAGE CLASSIFICATION</span>
          <h1>Image Scanner</h1>
          <p>
            Capture, enhance, and analyze your image with artificial
            intelligence.
          </p>
        </div>

        {/* Step progress */}
        <div className='stepper'>
          {steps.map((item, index) => (
            <div
              key={item.title}
              className={`stepper-item ${
                index === step ? "active" : ""
              } ${index < step ? "completed" : ""}`}
            >
              <div className='stepper-indicator'>
                {index < step ? "✓" : `0${index + 1}`}
              </div>

              <div className='stepper-label'>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </div>

              {index !== steps.length - 1 && <div className='stepper-line' />}
            </div>
          ))}
        </div>

        {/* Main wizard card */}
        <div className='wizard-card'>
          <div className='card-heading'>
            <div>
              <span className='step-caption'>STEP 0{step + 1} OF 04</span>

              <h2>{steps[step].title}</h2>
              <p>{steps[step].description}</p>
            </div>

            <div className='step-number'>0{step + 1}</div>
          </div>

          <div className='wizard-content'>
            {/* STEP A: CAPTURE */}
            {step === 0 && (
              <div className='step-content'>
                <div className='content-intro'>
                  <h3>Start with your image</h3>
                  <p>Use your camera to capture an image for classification.</p>
                </div>

                <div className='camera-container'>
                  <Camera onCapture={handleCapture} />
                </div>

                {preview && (
                  <div className='image-preview-card'>
                    <div className='preview-heading'>
                      <strong>Captured image</strong>
                      <span className='success-label'>Ready</span>
                    </div>

                    <img src={preview} alt='Captured image' />
                  </div>
                )}
              </div>
            )}

            {/* STEP B: CROP AND ENHANCE */}
            {step === 1 && (
              <div className='step-content'>
                <div className='content-intro'>
                  <h3>Enhance your image</h3>
                  <p>
                    Crop unwanted areas and apply the scanner filter to improve
                    the image.
                  </p>
                </div>

                {preview && (
                  <div className='image-preview-card'>
                    <div className='preview-heading'>
                      <strong>Original image</strong>
                    </div>

                    <img src={preview} alt='Original image' />

                    <button
                      className='secondary-button'
                      onClick={() => setShowCropper(true)}
                    >
                      Crop image
                    </button>
                  </div>
                )}

                {showCropper && preview && (
                  <ImageCropper
                    image={preview}
                    onCrop={handleCrop}
                    onCancel={() => setShowCropper(false)}
                  />
                )}

                <div className='filter-container'>
                  <CamScannerFilter
                    image={preview}
                    onApply={handleApplyFilter}
                  />
                </div>

                {processed && (
                  <div className='success-message'>
                    ✓ Image enhancement completed!
                  </div>
                )}
              </div>
            )}

            {/* STEP C: RESIZE */}
            {step === 2 && (
              <div className='step-content'>
                <div className='content-intro'>
                  <h3>Prepare for AI analysis</h3>
                  <p>
                    Resize the processed image to the model input dimensions.
                  </p>
                </div>

                <div className='resize-information'>
                  <div>
                    <span>Width</span>
                    <strong>224 px</strong>
                  </div>

                  <div>
                    <span>Height</span>
                    <strong>224 px</strong>
                  </div>

                  <div>
                    <span>Format</span>
                    <strong>JPEG</strong>
                  </div>
                </div>

                {processedPreview && (
                  <div className='resize-preview'>
                    <div className='preview-heading'>
                      <strong>Processed image</strong>
                    </div>
                    <img src={processedPreview} alt='Processed image' />
                  </div>
                )}

                <button
                  className='primary-button resize-button'
                  onClick={handleResize}
                  disabled={resizing}
                >
                  {resizing
                    ? "Resizing image..."
                    : resized
                      ? "Resize again"
                      : "Resize image"}
                </button>

                {resizedPreview && (
                  <div className='image-preview-card resized-card'>
                    <div className='preview-heading'>
                      <strong>Model input image</strong>
                      <span className='success-label'>224 × 224</span>
                    </div>

                    <img
                      src={resizedPreview}
                      width={224}
                      height={224}
                      alt='Resized image'
                    />
                  </div>
                )}
              </div>
            )}

            {/* STEP D: CLASSIFICATION */}
            {step === 3 && (
              <div className='step-content'>
                <div className='content-intro'>
                  <h3>Analyze your image</h3>
                  <p>
                    Your image is ready. Let both AI models identify the most
                    likely classes.
                  </p>
                </div>

                {resizedPreview && (
                  <div className='analysis-preview'>
                    <img src={resizedPreview} alt='Image for classification' />

                    <div>
                      <strong>Image ready for analysis</strong>
                      <span>224 × 224 pixels</span>
                    </div>
                  </div>
                )}

                <button
                  className='primary-button analyze-button'
                  onClick={handlePredict}
                  disabled={
                    loadedCount === 0 ||
                    modelLoading ||
                    predicting ||
                    classNames.length !== 49
                  }
                >
                  {predicting
                    ? "Analyzing image..."
                    : loadedCount === 0
                      ? "AI models unavailable"
                      : classNames.length !== 49
                        ? "Loading class names..."
                        : "✦  Analyze with both models"}
                </button>

                {predicting && (
                  <div className='loading-message'>
                    <div className='loading-spinner' />
                    <p>AI is analyzing your image...</p>
                  </div>
                )}

                {results && (
                  <div className='results-container'>
                    <div className='results-heading'>
                      <span className='eyebrow'>CLASSIFICATION COMPLETE</span>
                      <h3>Top 5 Predictions</h3>
                      <p>Most likely classes identified by each model.</p>
                    </div>

                    <div className='results-grid'>
                      {MODEL_CONFIGS.map(({ key, label }) => {
                        const preds = results[key];

                        return (
                          <div className='model-results' key={key}>
                            <h4 className='model-results-title'>{label}</h4>

                            {!preds ? (
                              <p>Model unavailable.</p>
                            ) : (
                              preds.slice(0, 5).map((prediction, index) => (
                                <div
                                  className={`prediction-item ${
                                    index === 0 ? "top-prediction" : ""
                                  }`}
                                  key={prediction.classIndex}
                                >
                                  <div className='prediction-rank'>
                                    {index + 1}
                                  </div>

                                  <div className='prediction-details'>
                                    <div className='prediction-name'>
                                      <strong>{prediction.className}</strong>
                                      <span>
                                        {(prediction.score * 100).toFixed(2)}%
                                      </span>
                                    </div>

                                    <div className='prediction-bar'>
                                      <div
                                        className='prediction-fill'
                                        style={{
                                          width: `${Math.min(
                                            100,
                                            Math.max(0, prediction.score * 100),
                                          )}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      className='secondary-button restart-button'
                      onClick={restart}
                    >
                      ↻ Start new classification
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className='wizard-navigation'>
            <button
              className='back-button'
              onClick={previousStep}
              disabled={step === 0}
            >
              ← Back
            </button>

            <div className='navigation-info'>{step + 1} / 4</div>

            {step !== 3 ? (
              <button
                className='primary-button continue-button'
                onClick={nextStep}
                disabled={!canContinue}
              >
                Continue →
              </button>
            ) : (
              <button
                className='primary-button continue-button'
                onClick={restart}
              >
                Start over ↻
              </button>
            )}
          </div>
        </div>

        <footer className='app-footer'>Powered by TensorFlow.js</footer>
      </section>
    </main>
  );
}

export default App;
