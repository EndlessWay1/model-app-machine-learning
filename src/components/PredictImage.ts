export interface PredictionResult {
  className: string;
  classIndex: number;
  score: number;
}

import * as tf from "@tensorflow/tfjs";

export async function predictImage(
  model: tf.GraphModel,
  image: HTMLCanvasElement,
  classNames: string[],
): Promise<PredictionResult[]> {
  if (classNames.length !== 49) {
    throw new Error(`Expected 49 classes, received ${classNames.length}`);
  }

  const channels = model.inputs[0].shape?.[3] ?? 3; // [null, 224, 224, C]

  const input = tf.tidy(() =>
    tf.browser
      .fromPixels(image, channels)
      .resizeBilinear([224, 224])
      .expandDims(0)
      .toFloat(),
  );

  try {
    const prediction = model.predict(input);

    let output: tf.Tensor;

    if (prediction instanceof tf.Tensor) {
      output = prediction;
    } else if (Array.isArray(prediction)) {
      prediction.forEach((tensor) => tensor.dispose());

      throw new Error(
        "Model returned multiple output tensors. Select the correct output.",
      );
    } else {
      // NamedTensorMap
      const outputNames = Object.keys(prediction);

      if (outputNames.length !== 1) {
        Object.values(prediction).forEach((tensor) => tensor.dispose());

        throw new Error(
          `Expected one output tensor, received ${outputNames.length}`,
        );
      }

      output = prediction[outputNames[0]];
    }

    const predictions = await output.data();

    output.dispose();

    if (predictions.length !== classNames.length) {
      throw new Error(
        `Expected ${classNames.length} predictions, received ${predictions.length}`,
      );
    }

    const top5 = Array.from(predictions)
      .map((score, index) => ({
        classIndex: index,
        className: classNames[index],
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return top5;
  } finally {
    input.dispose();
  }
}
