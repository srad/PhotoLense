import torch
import timm
import json
import os
import urllib.request

# Based on tutorial: https://huggingface.co/docs/timm/models/mobilenet-v3

def export_model():
    # 0. Setup output directory
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated_models")
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. Load MobileNet V3 Large (pretrained on ImageNet)
    model_name = 'mobilenetv3_large_100'
    print(f"Loading {model_name}...")
    model = timm.create_model(model_name, pretrained=True)
    model.eval()

    # 2. Export to ONNX
    output_onnx = os.path.join(output_dir, "mobilenetv3_large.onnx")
    print(f"Exporting model to {output_onnx}...")
    
    # Create dummy input (1 image, 3 channels, 224x224 resolution)
    dummy_input = torch.randn(1, 3, 224, 224)

    torch.onnx.export(
        model,
        dummy_input,
        output_onnx,
        export_params=True,
        opset_version=18,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )

    # 2.5. Ensure single file (inline weights)
    import onnx
    print("Ensuring model is self-contained...")
    onnx_model = onnx.load(output_onnx)
    try:
        from onnx.external_data_helper import convert_model_to_external_data
        # Actually we want the opposite: load_external_data_for_model handles loading, 
        # saving usually inlines if small.
        # But if it's already split, we might need to load it fully.
        pass
    except ImportError:
        pass
    
    # onnx.save will inline data for small models by default
    onnx.save(onnx_model, output_onnx)
    
    # Remove the .data file if it exists
    data_file = output_onnx + ".data"
    if os.path.exists(data_file):
        print(f"Removing external data file: {data_file}")
        os.remove(data_file)

    # 3. Generate config.json (id2label)
    output_config = os.path.join(output_dir, "mobilenetv3_config.json")
    print(f"Generating config to {output_config}...")
    
    config = {
        "architectures": ["MobileNetV3Large"],
        "model_type": "mobilenet_v3",
        "num_labels": 1000,
        "image_size": 224,
    }
    
    print("Downloading standard ImageNet labels...")
    url = "https://huggingface.co/datasets/huggingface/label-files/raw/main/imagenet-1k-id2label.json"
    try:
        with urllib.request.urlopen(url) as response:
            id2label = json.loads(response.read().decode())
            config["id2label"] = id2label
            config["label2id"] = {v: k for k, v in id2label.items()}
    except Exception as e:
        print(f"Warning: Could not download labels ({e}). You will need to add 'id2label' manually.")

    with open(output_config, 'w') as f:
        json.dump(config, f, indent=2)

    print("\nDone!")
    print(f"1. Model: {os.path.abspath(output_onnx)}")
    print(f"2. Config: {os.path.abspath(output_config)}")
    print("\nNext Steps:")
    print("1. Copy these two files to your app's models directory:")
    print("   (e.g., C:\\Users\\...\\AppData\\Roaming\\com.sedrad.photolense\\models\\)")
    print("   - Rename the config file to 'mobilenetv3-config.json' if needed to match code.")
    print("   - Rename the model file to 'mobilenetv3-large.onnx' if needed.")
    print("2. Restart the app and select 'MobileNet V3 Large'.")

if __name__ == "__main__":
    export_model()
