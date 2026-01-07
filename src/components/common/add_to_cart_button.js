import { useCart } from '../components/common/cart_context';


export default function AddToCartButton({ product, selectedColor, selectedSize, quantity }) {
  const { dispatch } = useCart();

  return (
    <button
      onClick={() =>
        dispatch({
          type: 'ADD',
          payload: {
            productId: product.id,
            name: product.name,
            price: product.price,
            image: product.images[0]?.url,
            selectedColor,
            selectedSize,
            quantity,
          },
        })
      }
    >
      Add to Cart
    </button>
  );
}
