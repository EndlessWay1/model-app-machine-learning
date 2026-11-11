import * as tf from "@tensorflow/tfjs";
import { useEffect, useState } from "react";

function App() {
  const [model, setModel] = useState<tf.GraphModel | null>(null);

  useEffect(() => {
    async function loadModel() {
      try {
        await tf.ready();

        const loadedModel = await tf.loadGraphModel(
          "/models/tfjs_model/model.json",
        );

        setModel(loadedModel);

        console.log("Model loaded successfully!");
        console.log("Input:", loadedModel.inputs);
        console.log("Output:", loadedModel.outputs);

        const input = tf.zeros([1, 224, 224, 3]);

        const output = loadedModel.predict(input) as tf.Tensor;

        console.log(await output.array());

        input.dispose();
        output.dispose();
      } catch (error) {
        console.error("Error loading model:", error);
      }
    }

    loadModel();
  }, []);

  return (
    <div>
      <h1>TensorFlow.js Model</h1>
      <p>{model ? "Model Loaded" : "Loading Model..."}</p>
    </div>
  );
}

export default App;
